export interface SyncedCredential {
  version: 1;
  provider: string;
  tokenType: 'bearer' | 'oauth';
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes?: string[];
  user?: {
    id?: string | number;
    login?: string;
    name?: string;
    email?: string;
  };
  updatedAt: string;
}

export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubTokenSuccessResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubTokenErrorResponse {
  error:
    | 'authorization_pending'
    | 'slow_down'
    | 'expired_token'
    | 'unsupported_grant_type'
    | 'incorrect_client_credentials'
    | 'incorrect_device_code'
    | 'access_denied'
    | string;
  error_description?: string;
  error_uri?: string;
}

export type GitHubTokenResponse = GitHubTokenSuccessResponse | GitHubTokenErrorResponse;

export interface GitHubUserInfo {
  login: string;
  id: number;
  name?: string | null;
  email?: string | null;
  scopes: string[];
}
