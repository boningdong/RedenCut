export type ProjectCommand = 'new' | 'open' | 'save' | 'save-as' | 'close'
export interface ProjectCloseRequest {
  requestId: string
}
