import { Body, Controller, Get, Post, Req, Res, HttpCode } from '@nestjs/common';
import { IsEmail, IsString, Length, IsOptional, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Request, Response } from 'express';
import { ACCESS_SECONDS, Account, AuthService, SESSION_SECONDS } from './auth.service';
import { cookie, CurrentUser, Public } from './auth.guard';
export class LoginDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(1, 128) password!: string;
}
export class RegisterDto extends LoginDto {
  @IsString() @Length(12, 128) declare password: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 80) @Matches(/\S/) name!: string;
  @IsOptional() @IsString() @MaxLength(128) setupCode?: string;
}
export class RecoveryCodesDto { @IsString() @Length(1, 128) password!: string; }
export class RecoverPasswordDto extends LoginDto {
  @IsString() @Length(12, 128) declare password: string;
  @IsString() @Length(32, 80) @Matches(/^[A-Fa-f0-9\s-]+$/) code!: string;
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Get('status') status() { return this.auth.status(); }
  @Public() @Post('register') async register(@Body() dto: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.limit(request.ip || 'unknown', dto.email);
    const session = await this.auth.register(dto.email, dto.name, dto.password, dto.setupCode);
    this.setCookies(response, session); return { user: session.user, recoveryCodes: session.recoveryCodes };
  }
  @Public() @Post('login') @HttpCode(200) async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.limit(request.ip || 'unknown', dto.email);
    const session = await this.auth.login(dto.email, dto.password);
    this.setCookies(response, session); return { user: session.user };
  }
  @Get('me') me(@CurrentUser() user: Account) { return { user }; }
  @Get('recovery-codes') recoveryStatus(@CurrentUser() user: Account, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.auth.recoveryStatus(user.id);
  }
  @Post('recovery-codes') @HttpCode(200) async recoveryCodes(@CurrentUser() user: Account, @Body() dto: RecoveryCodesDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); await this.auth.limit(request.ip || 'unknown', user.email);
    return this.auth.generateRecoveryCodes(user.id, dto.password);
  }
  @Public() @Post('recover') @HttpCode(200) async recover(@Body() dto: RecoverPasswordDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); await this.auth.limit(request.ip || 'unknown', dto.email);
    const result = await this.auth.recoverPassword(dto.email, dto.code, dto.password);
    for (const name of ['vq_access', 'vq_refresh']) response.clearCookie(name, this.options());
    return result;
  }
  @Public() @Post('refresh') @HttpCode(200) async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.refresh(cookie(request, 'vq_refresh')); this.setCookies(response, session); return { user: session.user };
  }
  @Public() @Post('logout') @HttpCode(200) async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(cookie(request, 'vq_refresh'), cookie(request, 'vq_access'));
    for (const name of ['vq_access', 'vq_refresh']) response.clearCookie(name, this.options());
    return { success: true };
  }
  private options() { return { httpOnly: true, secure: process.env.AUTH_COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_LOCAL_HTTP !== 'true'), sameSite: 'lax' as const, path: '/' }; }
  private setCookies(response: Response, session: { access: string; refresh: string }) {
    response.setHeader('Cache-Control', 'no-store');
    response.cookie('vq_access', session.access, { ...this.options(), maxAge: ACCESS_SECONDS * 1000 });
    response.cookie('vq_refresh', session.refresh, { ...this.options(), maxAge: SESSION_SECONDS * 1000 });
  }
}
