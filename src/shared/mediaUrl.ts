export const MEDIA_SCHEME = 'pedit-media'
/** pedit-media://local/<encodeURIComponent(absolute path)> */
export const mediaUrl = (absPath: string): string => `${MEDIA_SCHEME}://local/${encodeURIComponent(absPath)}`
