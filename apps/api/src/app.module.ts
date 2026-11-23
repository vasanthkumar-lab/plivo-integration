import { Module } from '@nestjs/common';
import { CrmService } from './crm/crm.service';
import { CrmController } from './crm/crm.controller';
import { EventsService } from './events/events.service';
import { EventsController } from './events/events.controller';
import { PlivoConfig } from './plivo/plivo.config';
import { PlivoService } from './plivo/plivo.service';
import { PlivoController } from './plivo/plivo.controller';
import { SimController } from './sim/sim.controller';
import { TunnelMonitor } from './plivo/tunnel.monitor';

@Module({
  controllers: [CrmController, EventsController, PlivoController, SimController],
  providers: [CrmService, EventsService, PlivoConfig, PlivoService, TunnelMonitor],
})
export class AppModule {}
