import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { FileSystemObjectStorage, ObjectStorage } from './object-storage';
import { S3ObjectStorage } from './s3-object-storage';

@Module({
  providers: [
    {
      provide: ObjectStorage,
      // `s3` in deployed environments (ADR-057); the filesystem for development and tests.
      useFactory: (config: AppConfig): ObjectStorage =>
        config.OBJECT_STORAGE === 's3'
          ? new S3ObjectStorage(config)
          : new FileSystemObjectStorage(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [ObjectStorage],
})
export class DocumentsModule {}
