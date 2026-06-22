// Isolates graph-renderer failures so a crash in the WebGL view never blacks out
// the whole app. Shows a recoverable message instead of unmounting the tree.
import { Component, type ReactNode } from 'react';
import { t } from '../../i18n';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}
interface State {
  error: Error | null;
}

export class GraphErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[graph] renderer crashed', error);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-200">
            <div className="font-medium text-red-100">{t('El grafo no se pudo renderizar')}</div>
            <p className="mt-1 text-red-300/90 break-words">{this.state.error.message}</p>
            <button className="btn btn-ghost border border-red-800 mt-3" onClick={this.reset}>
              {t('Reintentar')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
