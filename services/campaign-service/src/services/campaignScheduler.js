const cron = require('node-cron');
const db = require('../config/database');

// Process scheduled campaigns every minute
cron.schedule('* * * * *', async () => {
  try {
    await processScheduledCampaigns();
  } catch (error) {
    console.error('Error processing scheduled campaigns:', error);
  }
});

// Process campaign deliveries every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
  try {
    await processPendingDeliveries();
  } catch (error) {
    console.error('Error processing pending deliveries:', error);
  }
});

async function processScheduledCampaigns() {
  const query = `
    SELECT id, name, campaign_type, content, target_criteria
    FROM campaigns
    WHERE status = 'scheduled'
    AND (start_date IS NULL OR start_date <= NOW())
    AND (end_date IS NULL OR end_date > NOW())
  `;

  const result = await db.query(query);
  
  for (const campaign of result.rows) {
    console.log(`Processing scheduled campaign: ${campaign.name}`);
    
    // Update campaign status to active
    await db.query(
      'UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2',
      ['active', campaign.id]
    );
    
    // Process deliveries
    await processDeliveries(campaign.id);
  }
}

async function processPendingDeliveries() {
  const query = `
    SELECT cd.*, c.campaign_type, c.content, u.email, u.first_name, u.last_name
    FROM campaign_deliveries cd
    JOIN campaigns c ON cd.campaign_id = c.id
    JOIN users u ON cd.user_id = u.id
    WHERE cd.status = 'pending'
    AND c.status = 'active'
    LIMIT 100
  `;

  const result = await db.query(query);
  
  for (const delivery of result.rows) {
    try {
      await processDelivery(delivery);
    } catch (error) {
      console.error(`Error processing delivery ${delivery.id}:`, error);
      
      // Mark delivery as failed
      await db.query(
        'UPDATE campaign_deliveries SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
        ['failed', error.message, delivery.id]
      );
    }
  }
}

async function processDeliveries(campaignId) {
  const query = `
    UPDATE campaign_deliveries
    SET status = 'processing', updated_at = NOW()
    WHERE campaign_id = $1 AND status = 'pending'
  `;

  await db.query(query, [campaignId]);
  console.log(`Marked deliveries as processing for campaign ${campaignId}`);
}

async function processDelivery(delivery) {
  const { delivery_channel, content, email, first_name, last_name } = delivery;
  
  // Mark as sent
  await db.query(
    'UPDATE campaign_deliveries SET status = $1, sent_at = NOW(), updated_at = NOW() WHERE id = $2',
    ['sent', delivery.id]
  );
  
  // Simulate delivery processing
  switch (delivery_channel) {
    case 'email':
      console.log(`Sending email to ${email}: ${content.title}`);
      break;
    case 'push':
      console.log(`Sending push notification to user ${first_name} ${last_name}: ${content.title}`);
      break;
    case 'sms':
      console.log(`Sending SMS to user ${first_name} ${last_name}: ${content.body}`);
      break;
  }
  
  // Mark as delivered (simulate successful delivery)
  setTimeout(async () => {
    await db.query(
      'UPDATE campaign_deliveries SET status = $1, delivered_at = NOW(), updated_at = NOW() WHERE id = $2',
      ['delivered', delivery.id]
    );
  }, 1000);
}

module.exports = {
  processScheduledCampaigns,
  processPendingDeliveries
};