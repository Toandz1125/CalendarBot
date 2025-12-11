// file: dto/LoginResponse.js

export class AuthProvider {
  constructor({ id, provider, providerUserId, providerEmail, displayName, isPrimary, linkedAt }) {
    this.id = id;
    this.provider = provider;
    this.providerUserId = providerUserId;
    this.providerEmail = providerEmail;
    this.displayName = displayName;
    this.isPrimary = isPrimary;
    this.linkedAt = linkedAt ? new Date(linkedAt) : null;
  }
}

export class UserInfo {
  constructor({ userId, email, displayName, timezone, isActive, authProviders = [] }) {
    this.userId = userId;
    this.email = email;
    this.displayName = displayName;
    this.timezone = timezone;
    this.isActive = isActive;
    this.authProviders = authProviders.map(p => new AuthProvider(p));
  }
}

export class LoginData {
  constructor({ sessionToken, user }) {
    this.sessionToken = sessionToken;
    this.user = user ? new UserInfo(user) : null;
  }
}

export class LoginResponse {
  constructor({ success, message, data, errorCode, statusCode }) {
    this.success = success;
    this.message = message;
    this.data = data ? new LoginData(data) : null;
    this.errorCode = errorCode;
    this.statusCode = statusCode;
  }
}
