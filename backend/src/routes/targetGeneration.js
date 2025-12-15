import { FastifyPluginAsync } from 'fastify';
import * as targetService from '../services/targetGenerationService.js';

/**
 * Target-Based Generation Routes
 * Generates formulations from constraints
 */

const targetGenerationRoutes = async (fastify) => {
  // Generate formulations from targets
  fastify.post('/generate', async (request, reply) => {
    const {
      target_calories,
      target_sugar,
      target_cost_per_liter,
      beverage_type,
      max_ingredients = 10,
      min_ingredients = 5,
      count = 3,
      create_formulations = false,
    } = request.body;

    if (!target_calories && !target_sugar && !target_cost_per_liter) {
      return reply.code(400).send({ 
        error: 'At least one target constraint is required' 
      });
    }

    try {
      const candidates = await targetService.generateFromTargets({
        target_calories,
        target_sugar,
        target_cost_per_liter,
        beverage_type,
        max_ingredients,
        min_ingredients,
        count,
      });

      let formulations = [];
      if (create_formulations) {
        formulations = await targetService.createFormulationsFromCandidates(
          candidates,
          {
            name_prefix: 'Target-Based',
            beverage_type: beverage_type || 'soft_drink',
            tenant_id: request.body.tenant_id,
            created_by: request.body.created_by,
          }
        );
      }

      return reply.code(201).send({
        data: {
          candidates: candidates.map(c => ({
            ingredients: c.ingredients,
            score: c.score,
            values: c.values,
          })),
          formulations: formulations,
        },
        message: `Generated ${candidates.length} candidate formulations`,
      });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });
};

export default targetGenerationRoutes;

