// Bound credential input without assuming the length or encoding of a particular HF token type.
export const MAX_HUGGING_FACE_TOKEN_LENGTH = 16 * 1024

/** Accept access and OAuth tokens; the server determines validity and model permissions. */
export function isHuggingFaceToken(value: string): boolean {
  return value.length <= MAX_HUGGING_FACE_TOKEN_LENGTH && /^hf_[A-Za-z0-9._~+/-]+=*$/.test(value)
}
