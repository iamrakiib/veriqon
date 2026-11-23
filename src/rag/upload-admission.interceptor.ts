import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { defer, lastValueFrom } from 'rxjs';
import { AuthRequest } from '../auth/auth.guard';
import { WorkLimiter } from '../common/work-limiter';
import { MAX_FILE_BYTES } from './document-parser';

/** Runs before Multer: bound buffered uploads, including chunked/slow requests. */
@Injectable()
export class UploadAdmissionInterceptor implements NestInterceptor {
  private readonly receiving = new WorkLimiter();

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const length = Number(request.headers['content-length']);
    if (Number.isFinite(length) && length > MAX_FILE_BYTES + 65536) {
      throw new PayloadTooLargeException('Files must be 10 MB or smaller.');
    }
    return defer(() => this.receiving.run(request.user.id, async () => {
      // An idle timeout alone would let a client hold a slot by sending one byte at a time.
      const deadline = setTimeout(() => request.destroy(), 30000);
      deadline.unref();
      const received = () => clearTimeout(deadline);
      request.once('end', received);
      request.once('close', received);
      try { return await lastValueFrom(next.handle()); }
      finally {
        received();
        request.removeListener('end', received);
        request.removeListener('close', received);
      }
    }));
  }
}
