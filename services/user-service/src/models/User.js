const db = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  constructor(userData) {
    this.id = userData.id;
    this.email = userData.email;
    this.password = userData.password;
    this.firstName = userData.first_name;
    this.lastName = userData.last_name;
    this.phoneNumber = userData.phone_number;
    this.dateOfBirth = userData.date_of_birth;
    this.preferences = userData.preferences;
    this.isEmailVerified = userData.is_email_verified;
    this.loyaltyTier = userData.loyalty_tier;
    this.totalPoints = userData.total_points;
    this.createdAt = userData.created_at;
    this.updatedAt = userData.updated_at;
  }

  static async create(userData) {
    const {
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      dateOfBirth,
      preferences = {}
    } = userData;

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const query = `
      INSERT INTO users (
        email, password_hash, first_name, last_name, phone_number, 
        date_of_birth, preferences, loyalty_tier, total_points
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, email, first_name, last_name, phone_number, 
                date_of_birth, preferences, is_email_verified, 
                loyalty_tier, total_points, created_at, updated_at
    `;

    const values = [
      email,
      hashedPassword,
      firstName,
      lastName,
      phoneNumber,
      dateOfBirth,
      JSON.stringify(preferences),
      'bronze', // Default tier
      0 // Default points
    ];

    const result = await db.query(query, values);
    return new User(result.rows[0]);
  }

  static async findByEmail(email) {
    const query = `
      SELECT id, email, password_hash as password, first_name, last_name, 
             phone_number, date_of_birth, preferences, is_email_verified, 
             loyalty_tier, total_points, created_at, updated_at
      FROM users 
      WHERE email = $1 AND deleted_at IS NULL
    `;
    
    const result = await db.query(query, [email]);
    return result.rows[0] ? new User(result.rows[0]) : null;
  }

  static async findById(id) {
    const query = `
      SELECT id, email, password_hash as password, first_name, last_name, 
             phone_number, date_of_birth, preferences, is_email_verified, 
             loyalty_tier, total_points, created_at, updated_at
      FROM users 
      WHERE id = $1 AND deleted_at IS NULL
    `;
    
    const result = await db.query(query, [id]);
    return result.rows[0] ? new User(result.rows[0]) : null;
  }

  async validatePassword(password) {
    return await bcrypt.compare(password, this.password);
  }

  async updateProfile(updateData) {
    const allowedFields = [
      'first_name', 'last_name', 'phone_number', 'date_of_birth', 'preferences'
    ];
    
    const updates = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${paramCount}`);
        values.push(key === 'preferences' ? JSON.stringify(updateData[key]) : updateData[key]);
        paramCount++;
      }
    });

    if (updates.length === 0) {
      return this;
    }

    updates.push(`updated_at = NOW()`);
    values.push(this.id);

    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, email, first_name, last_name, phone_number, 
                date_of_birth, preferences, is_email_verified, 
                loyalty_tier, total_points, created_at, updated_at
    `;

    const result = await db.query(query, values);
    return new User(result.rows[0]);
  }

  async verifyEmail() {
    const query = `
      UPDATE users 
      SET is_email_verified = true, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, first_name, last_name, phone_number, 
                date_of_birth, preferences, is_email_verified, 
                loyalty_tier, total_points, created_at, updated_at
    `;

    const result = await db.query(query, [this.id]);
    return new User(result.rows[0]);
  }

  toJSON() {
    const user = { ...this };
    delete user.password; // Never expose password hash
    return user;
  }
}

module.exports = User;