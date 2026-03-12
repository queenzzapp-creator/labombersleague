import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = 'Ha ocurrido un error inesperado.';
      let isPermissionError = false;

      try {
        const errorText = this.state.error?.message || '';
        if (errorText.startsWith('{')) {
          const parsedError = JSON.parse(errorText);
          if (parsedError.error) {
            errorMessage = `Error de Base de Datos: ${parsedError.error}`;
            if (parsedError.error.includes('Missing or insufficient permissions')) {
              isPermissionError = true;
              errorMessage = 'No tienes permisos para realizar esta acción. Por favor, asegúrate de estar identificado correctamente.';
            }
          }
        } else {
          errorMessage = errorText;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full space-y-6 bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl backdrop-blur-xl">
            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
              <span className="text-4xl">⚠️</span>
            </div>
            <h1 className="text-2xl font-bold text-white">¡Ups! Algo salió mal</h1>
            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
              <p className="text-zinc-400 text-sm leading-relaxed">{errorMessage}</p>
            </div>
            <div className="space-y-3 pt-4">
              <button
                onClick={() => window.location.reload()}
                className="w-full fire-gradient text-white font-bold py-4 rounded-xl shadow-lg shadow-red-500/20 active:scale-95 transition-all"
              >
                REINTENTAR
              </button>
              {isPermissionError && (
                <button
                  onClick={() => {
                    localStorage.clear();
                    window.location.reload();
                  }}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-3 rounded-xl transition-all text-sm"
                >
                  LIMPIAR SESIÓN Y REINTENTAR
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
