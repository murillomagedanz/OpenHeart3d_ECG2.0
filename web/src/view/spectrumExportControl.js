import { serializeSpectrumExport, spectrumExportFilename } from '../io/spectrumExport.js';

export class SpectrumExportControl {
  constructor(button, status, { document = button.ownerDocument, URL = globalThis.URL,
    Blob = globalThis.Blob, defer = (callback) => setTimeout(callback, 1000) } = {}) {
    this.button = button;
    this.status = status;
    this.dataset = null;
    this.download = { document, URL, Blob, defer };
    button.addEventListener('click', () => this.export());
    this.setDataset(null);
  }

  setDataset(dataset, invalidated = false) {
    const changed = Boolean(dataset) !== Boolean(this.dataset);
    this.dataset = dataset;
    this.button.disabled = !dataset;
    const reason = invalidated
      ? 'Exportação indisponível: lacuna/amostra inválida; aguarde 10 s contínuos válidos.'
      : 'Exportação indisponível: aguarde uma janela completa de 10 s válidos.';
    this.button.title = dataset ? 'Baixar resultados e metadados; sem amostras do sinal.' : reason;
    if (!dataset || changed) this.status.textContent = dataset ? 'JSON disponível apenas para download local.' : reason;
  }

  export() {
    if (!this.dataset) return;
    const { document, URL, Blob, defer } = this.download;
    let url;
    let anchor;
    try {
      const json = serializeSpectrumExport(this.dataset);
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = spectrumExportFilename(this.dataset.metadata);
      document.body.appendChild(anchor);
      anchor.click();
      this.status.textContent = 'Download JSON solicitado ao navegador; confirme o arquivo nos downloads.';
    } catch (error) {
      this.status.textContent = `Falha ao exportar JSON: ${error.message}`;
    } finally {
      anchor?.remove();
      // Keep the URL alive until the browser has consumed the download request.
      if (url) defer(() => URL.revokeObjectURL(url));
    }
  }
}
