import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Captura excepciones de render para que una pantalla del frontend no rompa
 * toda la app dejando un white screen. Muestra un fallback con detalle técnico
 * colapsado y un botón para recargar.
 *
 * No reemplaza el manejo de errores async (ApiError, etc.) — eso ya lo hace
 * cada página con su useState<error>. Esto es para errores de render JS
 * verdaderamente inesperados.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] excepción capturada', error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">!</div>
            <h1>Algo salió mal en esta pantalla</h1>
            <p>
              No te preocupes: tus datos están a salvo. El sistema encontró un error
              al mostrar esta pantalla. Probá recargar; si vuelve a pasar, avisale al administrador.
            </p>
            <div className="error-boundary-actions">
              <button type="button" className="btn btn-primary" onClick={this.handleReload}>
                Recargar pantalla
              </button>
              <button type="button" className="btn btn-ghost" onClick={this.handleHome}>
                Ir al inicio
              </button>
            </div>
            <details className="error-boundary-details">
              <summary>Detalle técnico (para el administrador)</summary>
              <pre>{this.state.error.message}</pre>
              {this.state.error.stack && <pre className="small">{this.state.error.stack}</pre>}
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
