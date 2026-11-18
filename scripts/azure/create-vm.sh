#!/usr/bin/env bash
# Creates the Azure VM for compose.azure.yaml: a resource group, a firewall (network security
# group) that lets in HTTP, HTTPS and SSH from your address only, a fixed public address with
# an Azure DNS name, and an Ubuntu VM with Docker and this repository cloned.
#
#   az login
#   scripts/azure/create-vm.sh
#
# Settings (environment variables, all optional):
#   RESOURCE_GROUP  closest-wins
#   LOCATION        swedencentral
#   VM_NAME         closest-wins
#   VM_SIZE         Standard_B2s (2 vCPU, 4 GB: enough to build the image on the VM)
#   ADMIN_USER      azureuser
#   DNS_LABEL       closest-wins-<random>  -> <label>.<location>.cloudapp.azure.com
#   SSH_SOURCE      address or CIDR allowed to SSH in; default: your current public address
#   REPO_URL        https://github.com/Snidd/closest-wins.git (must be readable without login)
#
# Safe to run again: it updates what exists. To remove everything:
#   az group delete --name "$RESOURCE_GROUP"
set -euo pipefail

RESOURCE_GROUP=${RESOURCE_GROUP:-closest-wins}
LOCATION=${LOCATION:-swedencentral}
VM_NAME=${VM_NAME:-closest-wins}
VM_SIZE=${VM_SIZE:-Standard_B2s}
ADMIN_USER=${ADMIN_USER:-azureuser}
REPO_URL=${REPO_URL:-https://github.com/Snidd/closest-wins.git}
NSG_NAME="$VM_NAME-nsg"
IP_NAME="$VM_NAME-ip"

command -v az >/dev/null || { echo "The Azure CLI (az) is not installed: https://aka.ms/install-azure-cli" >&2; exit 1; }
az account show >/dev/null 2>&1 || { echo "Not logged in: run 'az login' first." >&2; exit 1; }

if [ -z "${SSH_SOURCE:-}" ]; then
	SSH_SOURCE=$(curl -fsS -4 --max-time 10 https://api.ipify.org || true)
	[[ "$SSH_SOURCE" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || {
		echo "Could not find your public address; set SSH_SOURCE (an address or CIDR)." >&2
		exit 1
	}
fi

echo "Subscription:   $(az account show --query name -o tsv)"
echo "Resource group: $RESOURCE_GROUP ($LOCATION)"
echo "VM:             $VM_NAME ($VM_SIZE), SSH allowed from $SSH_SOURCE"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# The DNS label must be unique in the region; keep the one a previous run chose.
if [ -z "${DNS_LABEL:-}" ]; then
	DNS_LABEL=$(az network public-ip show -g "$RESOURCE_GROUP" -n "$IP_NAME" --query dnsSettings.domainNameLabel -o tsv 2>/dev/null || true)
	[ -n "$DNS_LABEL" ] || DNS_LABEL="closest-wins-$(openssl rand -hex 3)"
fi

az network public-ip create -g "$RESOURCE_GROUP" -n "$IP_NAME" \
	--sku Standard --allocation-method Static --dns-name "$DNS_LABEL" --output none

az network nsg create -g "$RESOURCE_GROUP" -n "$NSG_NAME" --output none
rule() { # name priority port source
	az network nsg rule create -g "$RESOURCE_GROUP" --nsg-name "$NSG_NAME" -n "$1" \
		--priority "$2" --direction Inbound --access Allow --protocol Tcp \
		--destination-port-ranges "$3" --source-address-prefixes "$4" --output none
}
rule ssh 1000 22 "$SSH_SOURCE"
rule http 1010 80 '*' # Let's Encrypt validation and the redirect to https
rule https 1020 443 '*'

if az vm show -g "$RESOURCE_GROUP" -n "$VM_NAME" --output none 2>/dev/null; then
	echo "The VM already exists; firewall and address updated."
else
	# First boot: Docker with compose and buildx (the Dockerfile needs BuildKit), and the repo.
	cloud_init=$(mktemp)
	trap 'rm -f "$cloud_init"' EXIT
	cat >"$cloud_init" <<EOF
#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-v2
  - docker-buildx
  - git
runcmd:
  - usermod -aG docker $ADMIN_USER
  - systemctl enable --now docker
  - sudo -u $ADMIN_USER git clone $REPO_URL /home/$ADMIN_USER/closest-wins
EOF
	az vm create -g "$RESOURCE_GROUP" -n "$VM_NAME" \
		--image Ubuntu2404 --size "$VM_SIZE" \
		--admin-username "$ADMIN_USER" --generate-ssh-keys \
		--public-ip-address "$IP_NAME" --nsg "$NSG_NAME" \
		--os-disk-size-gb 64 \
		--custom-data "$cloud_init" --output none
fi

ADDRESS=$(az network public-ip show -g "$RESOURCE_GROUP" -n "$IP_NAME" --query ipAddress -o tsv)
FQDN=$(az network public-ip show -g "$RESOURCE_GROUP" -n "$IP_NAME" --query dnsSettings.fqdn -o tsv)

cat <<EOF

Done. Public address: $ADDRESS
      Azure DNS name: $FQDN

1. DOMAIN is either $FQDN as it is, or your own name: add an A record
   that points it at $ADDRESS and wait until it resolves.
2. Wait until the first boot has installed Docker (a couple of minutes), then log in. Log in
   after it has finished: a session opened earlier is not in the docker group yet
   ("permission denied ... docker.sock"); log out and in again if that happens.

     ssh $ADMIN_USER@$ADDRESS cloud-init status --wait
     ssh $ADMIN_USER@$ADDRESS
     cd closest-wins
     cp .env.azure.example .env.azure && nano .env.azure
     docker compose -f compose.azure.yaml --env-file .env.azure up -d --build

   The first start builds the image and downloads the map (a few minutes each).
3. Later updates:  git pull && docker compose -f compose.azure.yaml --env-file .env.azure up -d --build
EOF
