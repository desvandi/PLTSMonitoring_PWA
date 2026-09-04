import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type EspWebInstallButtonProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement> & {
    manifest?: string;
    erase?: boolean;
    'show-log'?: boolean;
  },
  HTMLElement
>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': EspWebInstallButtonProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': EspWebInstallButtonProps;
    }
  }
}

export {};
