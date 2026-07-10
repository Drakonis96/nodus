// Top-level safety net: catches render errors from any view so a crash in one
// section never blanks the whole window. The shell (header + sidebar) stays
// mounted outside this boundary, so the user can always navigate away. Keying
// the boundary by the active view (see App.tsx) resets it automatically when the
// user switches sections.
import { Component, type ReactNode } from 'react';
import { t } from '../i18n';
import { Icon } from './ui';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}
interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[app] view crashed', error, info?.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
            <div className="flex items-center gap-2 font-medium text-red-800 dark:text-red-100">
              <Icon name="alert" /> {t('Algo ha fallado en esta sección')}
            </div>
            <p className="mt-2 text-red-600/90 dark:text-red-300/90">
              {t('Se produjo un error inesperado al mostrar esta vista. El resto de la app sigue funcionando: reinténtalo o cambia de sección.')}
            </p>
            <p className="mt-2 font-mono text-xs break-words text-red-500/80 dark:text-red-300/70">{this.state.error.message}</p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-ghost border border-red-300 dark:border-red-800" onClick={this.reset}>
                {t('Reintentar')}
              </button>
              <button className="btn btn-ghost border border-red-300 dark:border-red-800" onClick={() => window.location.reload()}>
                {t('Recargar Nodus')}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
