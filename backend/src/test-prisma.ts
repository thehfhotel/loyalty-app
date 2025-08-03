import { connectPrisma, disconnectPrisma, db } from './config/prisma';
import { PrismaUserService } from './services/prismaUserService';
import { logger } from './utils/logger';

async function testPrismaConnection() {
  logger.info('🧪 Testing Prisma connection and basic operations...');
  
  try {
    // Test connection
    await connectPrisma();
    logger.info('✅ Prisma connection successful');

    // Test basic query
    const userCount = await db.users.count();
    logger.info(`📊 Current user count: ${userCount}`);

    // Test service
    const userService = new PrismaUserService();
    const connectionTest = await userService.testConnection();
    logger.info(`🔌 Service connection test: ${connectionTest ? 'PASS' : 'FAIL'}`);

    // Test complex query with relations
    const usersWithProfiles = await db.users.findMany({
      include: {
        user_profiles: true,
        user_loyalty: {
          include: {
            tiers: true,
          },
        },
      },
      take: 3,
    });

    logger.info(`👥 Sample users with profiles: ${usersWithProfiles.length}`);
    
    if (usersWithProfiles.length > 0) {
      const sampleUser = usersWithProfiles[0];
      logger.info(`📋 Sample user: ${sampleUser.email} (ID: ${sampleUser.id})`);
      logger.info(`👤 Profile: ${sampleUser.user_profiles?.first_name} ${sampleUser.user_profiles?.last_name}`);
      logger.info(`🏆 Current points: ${sampleUser.user_loyalty?.current_points ?? 0}`);
      logger.info(`🎖️ Tier: ${sampleUser.user_loyalty?.tiers?.name ?? 'None'}`);
    }

    // Test enum values
    const couponStatuses = await db.coupons.groupBy({
      by: ['status'],
      _count: true,
    });
    logger.info(`🎫 Coupon statuses:`, couponStatuses);

    logger.info('🎉 All Prisma tests passed successfully!');
    
  } catch (error) {
    logger.error('❌ Prisma test failed:', error);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testPrismaConnection();
}

export { testPrismaConnection };