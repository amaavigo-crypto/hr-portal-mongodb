/**
 * The document libraries (pdf-lib, docx, pako, jszip, jspdf) are large: together they were about two thirds of the
 * app's first download. Most screens never touch them, so these wrappers load `documentStamper` (and with it those
 * libraries) the first time a document is stamped, previewed or downloaded. Same names and arguments as before.
 */
import type * as Stamper from './documentStamper';

export type { HeaderFooterMetadata, CorporateDocxOptions, StampResult } from './documentStamper';

let stamper: Promise<typeof Stamper> | null = null;
const load = () => (stamper ??= import('./documentStamper'));

export const stampPdfWithHeaderFooter: typeof Stamper.stampPdfWithHeaderFooter = async (...a) => (await load()).stampPdfWithHeaderFooter(...a);
export const stampDocxWithHeaderFooter: typeof Stamper.stampDocxWithHeaderFooter = async (...a) => (await load()).stampDocxWithHeaderFooter(...a);
export const cleanDocxDataUrl: typeof Stamper.cleanDocxDataUrl = async (...a) => (await load()).cleanDocxDataUrl(...a);
export const downloadDocumentWithIntactFormat: typeof Stamper.downloadDocumentWithIntactFormat = async (...a) => (await load()).downloadDocumentWithIntactFormat(...a);
export const resolveDocumentBytes: typeof Stamper.resolveDocumentBytes = async (...a) => (await load()).resolveDocumentBytes(...a);
export const generateCorporateDocxBlob: typeof Stamper.generateCorporateDocxBlob = async (...a) => (await load()).generateCorporateDocxBlob(...a);

/** Starts downloading the document libraries in the background, e.g. when a document screen opens. */
export const preloadDocumentTools = () => { void load().catch(() => { stamper = null; }); };
