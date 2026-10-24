import { CSSProperties, ReactNode, useState } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

export interface PixelButtonProps {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
  title?: string;
}

const heightBySize: Record<Size, number> = { sm: 26, md: 32, lg: 40 };
const padBySize: Record<Size, string> = { sm: '0 10px', md: '0 14px', lg: '0 18px' };

export function PixelButton({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  style,
  title
}: PixelButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);

  const disabledText = 'var(--cth-ink-500)';

  const palette = (() => {
    switch (variant) {
      case 'primary':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-amber-bright)' : 'var(--cth-amber)'),
          text:    disabled ? disabledText : '#0C0A07',
          border:  'var(--cth-amber)',
          shadow:  'transparent'
        };
      case 'secondary':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-cream-300)' : 'var(--cth-cream-200)'),
          text:    disabled ? disabledText : 'var(--cth-ink-900)',
          border:  'var(--cth-ink-300)',
          shadow:  'transparent'
        };
      case 'ghost':
        return {
          fill:    hover ? 'var(--cth-cream-300)' : 'transparent',
          text:    disabled ? disabledText : 'var(--cth-ink-700)',
          border:  hover ? 'var(--cth-ink-300)' : 'transparent',
          shadow:  'transparent'
        };
      case 'destructive':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? '#C84C34' : 'var(--cth-coral)'),
          text:    disabled ? disabledText : '#F5EDD8',
          border:  'var(--cth-coral)',
          shadow:  'transparent'
        };
    }
  })();

  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => { setPressed(false); setHover(false); }}
      onMouseEnter={() => setHover(true)}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        lineHeight: 1,
        flexShrink: 0,
        height: heightBySize[size],
        padding: padBySize[size],
        background: palette.fill,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        borderRadius: 4,
        fontWeight: variant === 'primary' ? 700 : 500,
        transform: pressed && !disabled ? 'scale(0.98)' : 'none',
        transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
        fontFamily: 'var(--cth-font-ui)',
        fontSize: size === 'lg' ? 'var(--cth-text-body-md)' : 'var(--cth-text-body-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : 'auto',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {children}
    </button>
  );
}
