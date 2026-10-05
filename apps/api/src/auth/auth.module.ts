import { Module } from '@nestjs/common';

import { BackgroundTasks } from '../common/background-tasks';

import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { JwksController } from './jwks.controller';
import { LoginThrottleService } from './login-throttle.service';
import { MeController } from './me.controller';
import { MfaService } from './mfa.service';
import { OtpService } from './otp.service';
import { PermissionsGuard } from './permissions.guard';
import { ReauthService } from './reauth.service';
import { SessionService } from './session.service';
import { remoteKeyResolvers, SOCIAL_KEY_RESOLVERS, SocialIdentityVerifier } from './social.service';
import { AccessTokenService } from './tokens/access-token.service';

@Module({
  controllers: [AuthController, MeController, JwksController],
  providers: [
    AccessTokenService,
    AuthService,
    AuthGuard,
    PermissionsGuard,
    BackgroundTasks,
    CsrfService,
    LoginThrottleService,
    MfaService,
    OtpService,
    ReauthService,
    SessionService,
    SocialIdentityVerifier,
    { provide: SOCIAL_KEY_RESOLVERS, useFactory: remoteKeyResolvers },
  ],
  exports: [
    AccessTokenService,
    AuthGuard,
    PermissionsGuard,
    ReauthService,
    SessionService,
    BackgroundTasks,
  ],
})
export class AuthModule {}
