import {Module} from '@nestjs/common';
import {AuthModule} from '../auth/auth.module.js';
import {NearbyController} from './nearby.controller.js';
import {NearbyService} from './nearby.service.js';
import {NearbySnapshotService} from './nearby-snapshot.service.js';
import {NearbyWorkerService} from './nearby-worker.service.js';
import {NearbyRateLimitGuard} from './nearby-rate-limit.guard.js';
@Module({imports:[AuthModule],controllers:[NearbyController],providers:[NearbyService,NearbySnapshotService,NearbyWorkerService,NearbyRateLimitGuard]})
export class NearbyModule {}
