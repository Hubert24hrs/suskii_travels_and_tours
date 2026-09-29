import { Module } from '@nestjs/common';

import { FileSystemObjectStorage, ObjectStorage } from './object-storage';

@Module({
  // OBJECT_STORAGE only allows `filesystem` until the cloud adapters arrive (phase 12).
  providers: [{ provide: ObjectStorage, useClass: FileSystemObjectStorage }],
  exports: [ObjectStorage],
})
export class DocumentsModule {}
