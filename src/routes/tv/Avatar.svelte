<!-- A player's colour disc with their initial. Size via font-size of the parent (1em = disc). -->
<script lang="ts">
	import { textColorOn } from '#lib/ui/colors.ts';
	import { initial } from './tv.svelte.ts';

	type Props = {
		nickname: string;
		color: string;
		/** Diameter as a CSS length (default 1em). */
		size?: string;
		offline?: boolean;
		ring?: boolean;
		class?: string;
	};
	let { nickname, color, size = '1em', offline = false, ring = false, class: className }: Props = $props();
</script>

<span
	class={['avatar', { offline, ring }, className]}
	style:--av-size={size}
	style:--av={color}
	style:--av-ink={textColorOn(color)}
	aria-hidden="true"
>
	<span class="letter">{initial(nickname)}</span>
</span>

<style>
	.avatar {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--av-size);
		height: var(--av-size);
		border-radius: 50%;
		background:
			radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.38), transparent 55%),
			var(--av);
		color: var(--av-ink);
		box-shadow:
			inset 0 -0.08em 0.12em rgb(0 0 0 / 0.25),
			0 0.05em 0.2em rgb(0 0 0 / 0.35);
		transition:
			filter var(--duration-slow),
			opacity var(--duration-slow);
	}
	.ring {
		box-shadow:
			0 0 0 0.07em var(--tv-bg-1, #0a1630),
			0 0 0 0.13em var(--av),
			0 0.1em 0.4em rgb(0 0 0 / 0.4);
	}
	.letter {
		font-size: calc(var(--av-size) * 0.5);
		font-weight: 800;
		line-height: 1;
	}
	.offline {
		filter: grayscale(1) brightness(0.7);
		opacity: 0.55;
	}
</style>
