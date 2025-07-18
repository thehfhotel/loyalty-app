const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const { validate, schemas } = require('../utils/validation');

// Get all campaigns
router.get('/', async (req, res, next) => {
  try {
    const { status, campaignType, page = 1, limit = 20 } = req.query;
    
    const options = {
      status,
      campaignType,
      page: parseInt(page),
      limit: parseInt(limit)
    };
    
    const campaigns = await Campaign.findAll(options);
    
    res.json({
      success: true,
      data: {
        campaigns,
        pagination: {
          currentPage: parseInt(page),
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get campaign by ID
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const campaign = await Campaign.findById(id);
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        campaign: campaign.toJSON(),
        stats: campaign.stats
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create new campaign
router.post('/', validate(schemas.createCampaign), async (req, res, next) => {
  try {
    const campaignData = {
      ...req.body,
      createdBy: req.user.userId
    };
    
    const campaign = await Campaign.create(campaignData);
    
    res.status(201).json({
      success: true,
      message: 'Campaign created successfully',
      data: {
        campaign: campaign.toJSON()
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update campaign status
router.patch('/:id/status', validate(schemas.updateCampaignStatus), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const campaign = await Campaign.findById(id);
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    const updatedCampaign = await campaign.updateStatus(status);
    
    res.json({
      success: true,
      message: 'Campaign status updated successfully',
      data: {
        campaign: updatedCampaign.toJSON()
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get campaign target audience
router.get('/:id/audience', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const campaign = await Campaign.findById(id);
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    const audience = await campaign.getTargetAudience();
    
    res.json({
      success: true,
      data: {
        campaignId: id,
        targetCriteria: campaign.targetCriteria,
        audience,
        audienceSize: audience.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// Schedule campaign delivery
router.post('/:id/schedule', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const campaign = await Campaign.findById(id);
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    if (campaign.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft campaigns can be scheduled'
      });
    }
    
    const result = await campaign.scheduleDelivery();
    
    res.json({
      success: true,
      message: 'Campaign scheduled successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Get campaign metrics
router.get('/:id/metrics', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo } = req.query;
    
    const campaign = await Campaign.findById(id);
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    const dateRange = dateFrom && dateTo ? {
      from: new Date(dateFrom),
      to: new Date(dateTo)
    } : null;
    
    const metrics = await campaign.getDeliveryMetrics(dateRange);
    
    res.json({
      success: true,
      data: {
        campaignId: id,
        metrics,
        dateRange
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;