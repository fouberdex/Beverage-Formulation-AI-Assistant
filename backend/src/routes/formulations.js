import { FastifyPluginAsync } from 'fastify';
import * as formulationService from '../services/formulationService.js';
import { calculateNutrition, calculateCost } from '../services/formulationCalculations.js';

/**
 * Formulation Management Routes
 * Handles CRUD operations for 100,000+ formulations
 */

const formulationRoutes = async (fastify) => {
  // Get all formulations with filters
  fastify.get('/', async (request, reply) => {
    const filters = {
      beverage_type: request.query.beverage_type,
      status: request.query.status,
      tenant_id: request.query.tenant_id,
      is_latest_version: request.query.is_latest_version !== undefined 
        ? request.query.is_latest_version === 'true' 
        : true,
      search: request.query.search,
      limit: parseInt(request.query.limit || '50'),
      offset: parseInt(request.query.offset || '0'),
    };

    const formulations = await formulationService.getAllFormulations(filters);
    const count = await formulationService.getFormulationCount(filters);

    return {
      data: formulations,
      pagination: {
        total: count,
        limit: filters.limit,
        offset: filters.offset,
        has_more: filters.offset + filters.limit < count,
      },
    };
  });

  // Get formulation by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;
    const includeIngredients = request.query.include_ingredients !== 'false';
    const formulation = await formulationService.getFormulationById(id, includeIngredients);

    if (!formulation) {
      return reply.code(404).send({ error: 'Formulation not found' });
    }

    return { data: formulation };
  });

  // Create formulation
  fastify.post('/', async (request, reply) => {
    try {
      const formulation = await formulationService.createFormulation(request.body);
      return reply.code(201).send({ data: formulation });
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        return reply.code(409).send({ error: 'Formulation code already exists' });
      }
      throw error;
    }
  });

  // Update formulation
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const formulation = await formulationService.updateFormulation(id, request.body);
      if (!formulation) {
        return reply.code(404).send({ error: 'Formulation not found' });
      }
      return { data: formulation };
    } catch (error) {
      throw error;
    }
  });

  // Delete formulation (soft delete - archive)
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const formulation = await formulationService.deleteFormulation(id);

    if (!formulation) {
      return reply.code(404).send({ error: 'Formulation not found' });
    }

    return { data: formulation, message: 'Formulation archived successfully' };
  });

  // Create formulation version
  fastify.post('/:id/versions', async (request, reply) => {
    const { id } = request.params;
    try {
      const newVersion = await formulationService.createFormulationVersion(id, request.body);
      return reply.code(201).send({ data: newVersion });
    } catch (error) {
      if (error.message === 'Parent formulation not found') {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  // Get formulation versions
  fastify.get('/:id/versions', async (request, reply) => {
    const { id } = request.params;
    const versions = await formulationService.getFormulationVersions(id);
    return { data: versions };
  });

  // Calculate nutrition
  fastify.get('/:id/nutrition', async (request, reply) => {
    const { id } = request.params;
    const nutrition = await calculateNutrition(id);
    return { data: nutrition };
  });

  // Calculate cost
  fastify.get('/:id/cost', async (request, reply) => {
    const { id } = request.params;
    const batchSize = parseFloat(request.query.batch_size || '1');
    const cost = await calculateCost(id, batchSize);
    return { data: cost };
  });
};

export default formulationRoutes;

