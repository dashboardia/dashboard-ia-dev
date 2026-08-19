export function remoteTrackingRef(branch) {
  return `refs/remotes/origin/${branch}`;
}

export function remoteFetchRefspec(branch) {
  return `+refs/heads/${branch}:${remoteTrackingRef(branch)}`;
}
