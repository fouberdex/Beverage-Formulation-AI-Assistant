import { FastifyPluginAsync } from 'fastify';
import * as regulatoryService from '../services/regulatoryService.js';

/**
 * Regulatory & Labeling Routes
 * Handles Algerian compliance and label generation
 */

const regulatoryRoutes = async (fastify) => {
  // Check regulatory compliance
  fastify.post('/formulations/:formulationId/check', async (request, reply) => {
    const { formulationId } = request.params;
    
    try {
      const compliance = await regulatoryService.checkRegulatoryCompliance(formulationId);
      return reply.code(201).send({
        data: compliance,
        message: 'Regulatory compliance check completed',
      });
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Get compliance record
  fastify.get('/formulations/:formulationId/compliance', async (request, reply) => {
    const { formulationId } = request.params;
    
    try {
      const compliance = await regulatoryService.getComplianceRecord(formulationId);
      if (!compliance) {
        return reply.code(404).send({ error: 'Compliance record not found' });
      }
      return { data: compliance };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Generate labels (AR/FR/EN)
  fastify.post('/formulations/:formulationId/labels', async (request, reply) => {
    const { formulationId } = request.params;
    
    try {
      const labels = await regulatoryService.generateLabels(formulationId);
      return reply.code(201).send({
        data: labels,
        message: 'Labels generated successfully',
      });
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  // Get labels
  fastify.get('/formulations/:formulationId/labels', async (request, reply) => {
    const { formulationId } = request.params;
    const { language } = request.query; // 'ar', 'fr', 'en', or all
    
    try {
      const compliance = await regulatoryService.getComplianceRecord(formulationId);
      if (!compliance) {
        return reply.code(404).send({ error: 'Labels not found. Generate labels first.' });
      }

      const labels = {};
      if (language) {
        const key = `label_data_${language}`;
        if (compliance[key]) {
          labels[language] = compliance[key];
        }
      } else {
        if (compliance.label_data_ar) labels.ar = compliance.label_data_ar;
        if (compliance.label_data_fr) labels.fr = compliance.label_data_fr;
        if (compliance.label_data_en) labels.en = compliance.label_data_en;
      }

      return { data: labels };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });
};

export default regulatoryRoutes;

