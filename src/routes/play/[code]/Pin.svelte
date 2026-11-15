<!-- The player's map pin in their colour (decorative). -->
<script lang="ts">
	let { color, size = '3rem' }: { color: string; size?: string } = $props();
</script>

<svg class="pin" viewBox="0 0 40 52" style:--pin={color} style:width={size} style:height="calc({size} * 1.3)" aria-hidden="true">
	<path
		class="body"
		d="M20 2C10.1 2 2 9.9 2 19.7 2 32.5 20 50 20 50s18-17.5 18-30.3C38 9.9 29.9 2 20 2z"
	/>
	<circle class="hole" cx="20" cy="19.5" r="6.5" />
</svg>

<style>
	.pin {
		display: block;
		overflow: visible;
		filter: drop-shadow(0 4px 6px rgb(0 0 0 / 0.25));
	}
	.body {
		fill: var(--pin);
		stroke: #ffffff;
		stroke-width: 3;
		stroke-linejoin: round;
	}
	.hole {
		fill: #ffffff;
	}
</style>
