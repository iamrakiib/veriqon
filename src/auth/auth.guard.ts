import { CanActivate, ExecutionContext, Injectable, SetMetadata, ForbiddenException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Account, AuthService } from './auth.service';

export const Public = () => SetMetadata('public', true);
export type AuthRequest = Request & { user: Account };
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthRequest>().user);
export function cookie(request: Request, name: string): string {
  const part = request.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  if (!part) return '';
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return ''; }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const allowed = (process.env.APP_ORIGINS || 'http://localhost:3001,http://127.0.0.1:3001').split(',').map(v => v.trim());
      if (request.headers['x-veriqon-request'] !== '1' || (request.headers.origin && !allowed.includes(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site') throw new ForbiddenException('Request origin could not be verified. Refresh the page and retry.');
    }
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) return true;
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    request.user = await this.auth.authenticate(bearer || cookie(request, 'vq_access'));
    return true;
  }
}
