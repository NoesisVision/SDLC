/**
 * Encode a project path to match Claude Code's session directory naming
 *
 * Claude Code encodes paths by replacing '/' with '-' and prepending '-'
 * Example: /home/user/project -> -home-user-project
 */
export function encodeProjectPath(path: string): string {
  // Normalize path (remove trailing slash)
  const normalized = path.replace(/\/$/, '');

  // Replace slashes with hyphens and prepend hyphen
  return '-' + normalized.replace(/\//g, '-');
}

/**
 * Decode a session directory name back to project path
 */
export function decodeProjectPath(encoded: string): string {
  // Remove leading hyphen and replace remaining hyphens with slashes
  return encoded.substring(1).replace(/-/g, '/');
}
