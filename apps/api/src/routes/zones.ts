import type { FastifyInstance } from 'fastify';
import { ZipCodeSchema } from '@landscape-architect/shared';
import { getZoneByZip } from '../services/zone-lookup.js';

export function zonesRoute(app: FastifyInstance): void {
  app.get<{ Params: { zip: string } }>('/api/v1/zones/:zip', async (request, reply) => {
    const { zip } = request.params;

    const parseResult = ZipCodeSchema.safeParse(zip);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ error: 'Invalid ZIP code', details: parseResult.error.issues });
    }

    const zone = getZoneByZip(parseResult.data);
    if (!zone) {
      return reply.status(404).send({ error: 'Zone not found for ZIP code' });
    }

    return reply.send(zone);
  });
}
