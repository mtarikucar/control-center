import { Component, type ReactNode } from 'react';

/** A model that fails to load falls back to its voxel stand-in instead of taking the scene down. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('model yüklenemedi, voksel yer tutucu gösteriliyor', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
