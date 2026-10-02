<script lang="ts">
  interface Props {
    /** Rendered width and height in CSS px; the mark is square. */
    size?: number;
    /** Colour of the partners, their union and the line to their child. */
    ink?: string;
    /** Colour of the child, the person in focus. */
    focus?: string;
    /**
     * Opacity, 0–1, of the lines up to the generation before. Faded so the mark reads as one
     * family with a past, not as three equal generations.
     */
    ancestryOpacity?: number;
    /** Accessible name; when absent the mark is decorative and hidden from assistive technology. */
    label?: string;
    class?: string;
  }

  let {
    size = 32,
    ink = 'currentColor',
    focus = '#fbbf24',
    ancestryOpacity = 0.45,
    label,
    class: className = ''
  }: Props = $props();
</script>

<!-- Geometry is shared with static/favicon.svg and static/brand/*.svg; change them together. -->
<svg
  width={size}
  height={size}
  viewBox="0 0 32 32"
  class={className}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <g fill="none" stroke={ink} stroke-linecap="round">
    <path d="M3.5 5H10.5M7 5V15M21.5 5H28.5M25 5V15" stroke-width="2.2" stroke-opacity={ancestryOpacity} />
    <path d="M7 15H25M16 15V22" stroke-width="2.6" />
  </g>
  <circle cx="7" cy="15" r="3.8" fill={ink} />
  <circle cx="25" cy="15" r="3.8" fill={ink} />
  <circle cx="16" cy="25" r="4" fill={focus} />
</svg>
