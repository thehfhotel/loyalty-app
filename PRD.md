# **Product Requirements Document: Hotel Loyalty App**

## **1\. Introduction**

### **1.1 Purpose**

This Product Requirements Document (PRD) outlines the features and functionalities for a new mobile loyalty application designed for The Harbour Front Hotel. The app aims to enhance customer engagement, foster loyalty, and provide a direct channel for communication, feedback, and personalized offers.

### **1.2 Scope**

This document covers the initial release (MVP \- Minimum Viable Product) of the loyalty application, focusing on core functionalities required to meet the primary objectives. Future iterations may expand upon these features.

### **1.3 Goals**

* Collect customer information and repeat customers.
* Increase customer retention and repeat bookings.
* Improve customer satisfaction through direct feedback channels.
* Drive incremental revenue through targeted marketing and promotions.
* Enhance the overall customer experience with exclusive benefits and personalized interactions.
* Build a comprehensive customer database for better understanding and segmentation.
* Connect customers from 2 location in 1 membership loyalty program.

## **2\. User Stories / Personas**

### **2.1 Customer Persona: The Frequent Traveler**

* As a frequent traveler, I want to easily see my loyalty points and current tier so I know what benefits I'm eligible for.
* As a frequent traveler, I want to receive exclusive offers and coupons tailored to my preferences so I can save money on my stays.
* As a frequent traveler, I want to provide feedback easily after my stay so my experience can be improved.
* As a frequent traveler, I want to feel valued and recognized for my loyalty.

### **2.2 Hotel Administrator Persona: The Marketing Manager**

* As a Marketing Manager, I want to view a comprehensive profile of each customer so I can understand their preferences and history.
* As a Marketing Manager, I want to easily create and send targeted marketing campaigns to specific customer segments.
* As a Marketing Manager, I want to design and distribute digital coupons to customers.
* As a Marketing Manager, I want to create and manage customer tiers and assign points for various activities.
* As a Marketing Manager, I want to send out surveys to gather feedback from guests.

## **3\. Features**

### **3.1 Customer Profiles / CRM (Knowing Your Customers)**

* **Description:** A system to capture, store, and manage detailed customer information and their interactions with the hotel.
* **Functionality:**
  * **Customer Registration/Login:** Secure user authentication (e.g., email/password, social login via Google, Facebook, LINE).
  * **Profile Management:** Customers can view and update their personal information (name, contact, preferences).
  * **Admin View:** Hotel staff can access comprehensive customer profiles including:
    * Contact details
    * Stay history (dates, room types, spend)
    * Loyalty points balance and tier status
    * Redeemed coupons/offers
    * Survey responses
    * Communication history (marketing campaigns received)
  * **Data Integration:** Ability to integrate with existing PMS (Property Management System) for seamless data flow (e.g., stay history, spend).

### **3.2 Survey Management (Push Survey for Feedback)**

* **Description:** A module to create, distribute, and analyze customer feedback surveys.
* **Functionality:**
  * **Survey Creation (Admin):** Hotel staff can create customizable surveys with various question types (e.g., multiple choice, rating scales, open-ended).
  * **Targeted Distribution:** Surveys can be pushed to specific customer segments (e.g., after check-out, based on tier).
  * **In-App Notifications:** Customers receive notifications for new surveys.
  * **Submission & Tracking:** Customers can complete and submit surveys within the app.
  * **Reporting & Analytics (Admin):** Hotel staff can view aggregated survey results, trends, and individual responses.

### **3.3 Marketing Campaign Management (Push Marketing Campaigns)**

* **Description:** A tool to design, schedule, and send targeted marketing communications to app users.
* **Functionality:**
  * **Campaign Creation (Admin):** Hotel staff can create various campaign types (e.g., promotional offers, event announcements, personalized greetings).
  * **Segmentation:** Ability to target campaigns based on customer data (e.g., tier, stay history, preferences, demographics).
  * **Content Editor:** Rich text editor for campaign messages, including images and links.
  * **Push Notifications:** Campaigns can be delivered via in-app push notifications.
    * **Note:** For PWA, push notifications will rely on Service Workers and browser capabilities.
  * **Scheduling:** Campaigns can be scheduled for future delivery.
  * **Performance Tracking (Admin):** View metrics such as open rates, click-through rates, and conversions for each campaign.

### **3.4 Coupon Management (Customers Can Have Coupons)**

* **Description:** A system for creating, distributing, and managing digital coupons for customers.
* **Functionality:**
  * **Coupon Creation (Admin):** Hotel staff can define coupon details (e.g., discount percentage/amount, validity period, usage limits, specific services/products).
  * **Distribution:** Coupons can be distributed via marketing campaigns, or automatically based on loyalty actions (e.g., tier upgrade).
  * **In-App Wallet:** Customers have a dedicated section in the app to view their available and redeemed coupons.
  * **Redemption:**
    * **QR Code/Barcode:** Unique QR code or barcode for each coupon for in-person redemption.
      * **Note:** PWA will leverage device camera access for QR/barcode scanning.
    * **Online Code:** A unique code for online booking/service redemption.
    * **Tracking (Admin):** Track coupon redemption status and usage.
  * **Expiration Notifications:** Reminders for expiring coupons.

### **3.5 Customer Tier and Points System**

* **Description:** A robust loyalty program structure with defined tiers and a points accumulation/redemption mechanism.
* **Functionality:**
  * **Tier Definition (Admin):** Hotel staff can define loyalty tiers (e.g., Bronze, Silver, Gold, Platinum) with associated benefits and criteria for advancement/retention (e.g., points earned, number of stays, total spend).
  * **Points Earning Rules (Admin):** Define how points are earned (e.g., points per dollar spent, bonus points for specific activities like direct bookings, social media shares, survey completion).
  * **Points Redemption (Admin/Customer):**
    * **Admin:** Define redemption options (e.g., free nights, room upgrades, F\&B discounts, spa credits).
    * **Customer:** Customers can view available redemption options and initiate redemption requests within the app.
  * **Points Balance & History (Customer):** Customers can view their current points balance and a detailed transaction history (points earned, points redeemed).
  * **Tier Status Display (Customer):** Clearly display current tier, progress towards next tier, and benefits of the current tier.
  * **Automatic Tier Progression:** System automatically updates customer tiers based on defined rules.

## **4\. Technical Requirements (High-Level)**

* **Platform:** Progressive Web Application (PWA) accessible via web browsers and installable on mobile devices.
  * **Offline Capability:** Core features should be accessible offline or with limited connectivity using Service Workers. (low priority)
  * **Push Notifications:** Support for web push notifications.
  * **Add to Home Screen:** Ability for users to "install" the PWA to their device's home screen.
  * **Responsive Design:** Optimized for various screen sizes (mobile, tablet, desktop).
* **Backend:** Robust, scalable, and secure backend infrastructure using docker compose on ubuntu server.
* **APIs:** Well-documented APIs for integration with PMS, payment gateways, and other hotel systems.
* **Security:** Adherence to data privacy regulations (e.g., GDPR, CCPA) and industry best practices for data encryption and user authentication.
* **Scalability:** Designed to handle a growing number of users and data. (100-1,000 users for this scope)
* **Analytics Integration:** Integration with analytics tools (e.g., Google Analytics, Firebase Analytics) for comprehensive usage tracking. (low priority)

## **5\. Future Considerations (Out of Scope for MVP)**

* Online Booking Integration within the app.
* In-app chat with concierge/front desk.
* Gamification elements (badges, leaderboards).
* Referral program.

## **6\. Key Performance Indicators (KPIs)**

* **Customer Engagement:**
  * Active user rates.
  * Feature usage (e.g., coupon redemption rate, survey completion rate).
  * Push notification engagement rate.
* **Loyalty & Retention:**
  * Repeat booking rate from app users.
  * Customer lifetime value (CLTV) of loyalty members.
  * Tier progression rates.
* **Revenue Impact:**
  * Revenue generated from app-exclusive offers/campaigns.
  * Average spend per loyalty member.
* **Customer Satisfaction:**
  * Average survey satisfaction scores.
  * NPS (Net Promoter Score) from app users.
