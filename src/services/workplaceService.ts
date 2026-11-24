import { apiJson } from './apiClient';

const call = <T = any>(prefix: string) => ({
  get: (action: string, params: Record<string, string | undefined> = {}) => {
    const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
    return apiJson<T>(`/api/leave/${prefix}-${action}${qs ? `?${qs}` : ''}`);
  },
  post: (action: string, body: unknown = {}) => apiJson<T>(`/api/leave/${prefix}-${action}`, body),
});
const es = call('esign'), en = call('engage'), as = call('assets');

export const workplaceService = {
  directory: () => en.get('directory'),
  // e-sign
  esignMine: () => es.get('mine'),
  esignAll: () => es.get('all'),
  esignGet: (id: string) => es.get('get', { id }),
  esignCreate: (b: unknown) => es.post('create', b),
  esignSign: (id: string, typedName: string, consent: boolean) => es.post('sign', { id, typedName, consent }),
  esignDecline: (id: string, reason: string) => es.post('decline', { id, reason }),
  esignCancel: (id: string) => es.post('cancel', { id }),
  esignVerify: (id: string) => es.get('verify', { id }),
  // surveys
  surveys: () => en.get('surveys'),
  survey: (id: string) => en.get('survey', { id }),
  saveSurvey: (b: unknown) => en.post('save-survey', b),
  publishSurvey: (id: string) => en.post('publish-survey', { id }),
  closeSurvey: (id: string) => en.post('close-survey', { id }),
  deleteSurvey: (id: string) => en.post('delete-survey', { id }),
  respond: (id: string, answers: unknown) => en.post('respond', { id, answers }),
  results: (id: string) => en.get('results', { id }),
  // wall
  feed: (before?: string) => en.get('feed', { before }),
  post: (b: unknown) => en.post('post', b),
  comment: (postId: string, text: string) => en.post('comment', { postId, text }),
  react: (postId: string, reaction: string) => en.post('react', { postId, reaction }),
  pin: (postId: string, pinned: boolean) => en.post('pin', { postId, pinned }),
  deletePost: (postId: string) => en.post('delete-post', { postId }),
  deleteComment: (id: string) => en.post('delete-comment', { id }),
  // assets
  myAssets: () => as.get('mine'),
  acknowledgeAsset: (id: string) => as.post('acknowledge', { id }),
  assets: (status?: string, q?: string) => as.get('list', { status, q }),
  asset: (id: string) => as.get('get', { id }),
  saveAsset: (b: unknown) => as.post('save', b),
  importAssets: (rows: unknown[]) => as.post('import', { rows }),
  assetAct: (b: unknown) => as.post('act', b),
  assetsPending: (uid: string) => as.get('pending', { uid }),
  assetSummary: () => as.get('summary'),
};
