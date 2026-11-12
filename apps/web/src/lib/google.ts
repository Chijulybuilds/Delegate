/**
 * Google Drive Picker with the `drive.file` scope (non-sensitive: the app only sees files the user
 * picks). Scripts load on demand, the first time someone attaches Drive proof.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load Google Drive. Check your connection or ad-blocker.'));
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

export interface PickedFile {
  fileId: string;
  name: string;
  accessToken: string;
}

export async function pickDriveFile(cfg: { clientId: string; apiKey: string; appId: string }): Promise<PickedFile | null> {
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')]);
  await new Promise<void>((resolve) => window.gapi.load('picker', () => resolve()));

  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (r: { access_token?: string; error?: string }) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Google access was not granted'))),
      error_callback: (e: { message?: string }) => reject(new Error(e.message ?? 'Google sign-in was closed')),
    });
    client.requestAccessToken({ prompt: '' });
  });

  const { picker } = window.google;
  return new Promise((resolve) => {
    new picker.PickerBuilder()
      .addView(new picker.DocsView().setIncludeFolders(false).setMode(picker.DocsViewMode.LIST))
      .setOAuthToken(accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setTitle('Pick your proof of work')
      .setCallback((data: { action: string; docs?: Array<{ id: string; name: string }> }) => {
        if (data.action === picker.Action.PICKED && data.docs?.[0]) resolve({ fileId: data.docs[0].id, name: data.docs[0].name, accessToken });
        if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
