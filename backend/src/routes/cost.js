import { FastifyPluginAsync } from 'fastify';
import * as costService from '../services/costService.js';

/**
 * Cost & ROI Routes
 * Handles batch costing and pricing history
 */

const costRoutes = async (fastify) => {
  // Calculate batch cost
  fastify.post('/formulations/:formulationId/batch-cost', async (request, reply) => {
    const { formulationId } = request.params;
    const {
      batch_size_liters,
      overhead_percent = 15,
      margin_percent = 30,
      volume_tier = 'standard',
      pricing_date,
    } = request.body;

    if (!batch_size_liters || batch_size_liters <= 0) {
      return reply.code(400).send({ error: 'batch_size_liters is required and must be > 0' });
    }

    try {
      const cost = await costService.calculateBatchCost(formulationId, batch_size_liters, {
        overhead_percent,
        margin_percent,
        volume_tier,
        pricing_date: pricing_date ? new Date(pricing_date) : new Date(),
      });
      return reply.code(201).send({ data: cost });
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Get batch cost calculations
  fastify.get('/formulations/:formulationId/batch-costs', async (request, reply) => {
    const { formulationId } = request.params;
    const filters = {
      limit: parseInt(request.query.limit || '50'),
      offset: parseInt(request.query.offset || '0'),
    };

    try {
      const calculations = await costService.getBatchCostCalculations(formulationId, filters);
      return { data: calculations };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Compare batch sizes
  fastify.get('/formulations/:formulationId/compare-batch-sizes', async (request, reply) => {
    const { formulationId } = request.params;
    const batchSizes = request.query.sizes 
      ? request.query.sizes.split(',').map(s => parseFloat(s))
      : [1, 10, 100, 1000, 10000];

    try {
      const comparisons = await costService.compareBatchSizes(formulationId, batchSizes);
      return { data: comparisons };
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Calculate ROI
  fastify.post('/formulations/:formulationId/roi', async (request, reply) => {
    const { formulationId } = request.params;
    const { batch_size_liters, selling_price_per_liter } = request.body;

    if (!batch_size_liters || !selling_price_per_liter) {
      return reply.code(400).send({ 
        error: 'batch_size_liters and selling_price_per_liter are required' 
      });
    }

    try {
      const roi = await costService.calculateROI(
        formulationId,
        batch_size_liters,
        selling_price_per_liter
      );
      return { data: roi };
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Add pricing history
  fastify.post('/ingredients/:ingredientId/pricing', async (request, reply) => {
    const { ingredientId } = request.params;
    const priceData = request.body;

    try {
      const pricing = await costService.addPricingHistory(ingredientId, priceData);
      return reply.code(201).send({ data: pricing });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Get pricing history
  fastify.get('/ingredients/:ingredientId/pricing', async (request, reply) => {
    const { ingredientId } = request.params;
    const filters = {
      start_date: request.query.start_date ? new Date(request.query.start_date) : null,
      end_date: request.query.end_date ? new Date(request.query.end_date) : null,
      limit: parseInt(request.query.limit || '100'),
      offset: parseInt(request.query.offset || '0'),
    };

    try {
      const history = await costService.getPricingHistory(ingredientId, filters);
      return { data: history };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });
};

export default costRoutes;








