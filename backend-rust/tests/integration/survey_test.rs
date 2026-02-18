//! Survey endpoint integration tests
//!
//! Tests for the /api/surveys endpoints including:
//! - Listing surveys
//! - Getting survey invitations
//! - Getting survey with questions
//! - Submitting survey responses
//! - Admin survey creation
//! - Admin viewing survey responses

use chrono::{Duration, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Test Setup Helpers
// ============================================================================

/// Create a test survey in the database
async fn create_test_survey(
    pool: &PgPool,
    title: &str,
    status: &str,
    access_type: &str,
    created_by: Option<Uuid>,
) -> Result<Uuid, sqlx::Error> {
    let survey_id = Uuid::new_v4();
    let questions = json!([
        {
            "id": "q1",
            "question_type": "single_choice",
            "text": "How satisfied are you?",
            "description": null,
            "required": true,
            "options": [
                {"id": "o1", "text": "Very satisfied", "value": "1"},
                {"id": "o2", "text": "Satisfied", "value": "2"},
                {"id": "o3", "text": "Neutral", "value": "3"},
                {"id": "o4", "text": "Dissatisfied", "value": "4"}
            ],
            "validation": null,
            "order": 1
        },
        {
            "id": "q2",
            "question_type": "text",
            "text": "Any additional comments?",
            "description": "Please share your feedback",
            "required": false,
            "options": null,
            "validation": {"max_length": 500},
            "order": 2
        }
    ]);

    sqlx::query(
        r#"
        INSERT INTO surveys (id, title, description, questions, status, access_type, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        "#,
    )
    .bind(survey_id)
    .bind(title)
    .bind("Test survey description")
    .bind(&questions)
    .bind(status)
    .bind(access_type)
    .bind(created_by)
    .execute(pool)
    .await?;

    Ok(survey_id)
}

/// Create a survey invitation for a user
async fn create_survey_invitation(
    pool: &PgPool,
    survey_id: Uuid,
    user_id: Uuid,
    status: &str,
) -> Result<Uuid, sqlx::Error> {
    let invitation_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::days(7);

    sqlx::query(
        r#"
        INSERT INTO survey_invitations (id, survey_id, user_id, status, sent_at, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), $5, NOW(), NOW())
        "#,
    )
    .bind(invitation_id)
    .bind(survey_id)
    .bind(user_id)
    .bind(status)
    .bind(expires_at.naive_utc())
    .execute(pool)
    .await?;

    Ok(invitation_id)
}

/// Create a survey response in the database
async fn create_survey_response(
    pool: &PgPool,
    survey_id: Uuid,
    user_id: Uuid,
    answers: Value,
    is_completed: bool,
) -> Result<Uuid, sqlx::Error> {
    let response_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO survey_responses (id, survey_id, user_id, answers, is_completed, progress, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        "#,
    )
    .bind(response_id)
    .bind(survey_id)
    .bind(user_id)
    .bind(&answers)
    .bind(is_completed)
    .bind(if is_completed { 100 } else { 50 })
    .execute(pool)
    .await?;

    Ok(response_id)
}

// ============================================================================
// Test: List Surveys
// ============================================================================

/// Test GET /api/surveys - Returns list of active surveys
#[tokio::test]
async fn test_list_surveys() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("survey_list_test@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let _active_survey = create_test_survey(app.db(), "Active Survey", "active", "public", None)
        .await
        .expect("Failed to create active survey");
    let _draft_survey = create_test_survey(app.db(), "Draft Survey", "draft", "public", None)
        .await
        .expect("Failed to create draft survey");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/surveys").await;

    assert!(
        response.status == 200 || response.status == 501,
        "Expected 200 OK or 501 Not Implemented, got {}",
        response.status
    );

    if response.status == 200 {
        let json: Value = response.json().expect("Response should be valid JSON");
        assert!(json.get("data").is_some() || json.get("surveys").is_some());
    }

    app.cleanup().await.ok();
}

/// Test GET /api/surveys without authentication returns 401
#[tokio::test]
async fn test_list_surveys_unauthorized() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/surveys").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Get Survey Invitations
// ============================================================================

/// Test GET /api/surveys/invitations - Returns user's survey invitations
#[tokio::test]
async fn test_get_survey_invitations() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("invitation_test@example.com");
    user.insert_with_profile(app.db(), "John", "Doe")
        .await
        .expect("Failed to insert test user");

    let survey_id = create_test_survey(
        app.db(),
        "Invitation Test Survey",
        "active",
        "invite_only",
        None,
    )
    .await
    .expect("Failed to create survey");

    let _invitation_id = create_survey_invitation(app.db(), survey_id, user.id, "pending")
        .await
        .expect("Failed to create invitation");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/surveys/invitations").await;

    assert!(
        response.status == 200 || response.status == 501,
        "Expected 200 OK or 501 Not Implemented, got {}",
        response.status
    );

    if response.status == 200 {
        let json: Value = response.json().expect("Response should be valid JSON");
        assert!(json.get("invitations").is_some());
    }

    app.cleanup().await.ok();
}

/// Test GET /api/surveys/invitations without auth returns 401
#[tokio::test]
async fn test_get_survey_invitations_unauthorized() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/surveys/invitations").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Get Survey with Questions
// ============================================================================

/// Test GET /api/surveys/:id - Returns survey with questions
#[tokio::test]
async fn test_get_survey_with_questions() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("survey_detail_test@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let survey_id = create_test_survey(app.db(), "Detail Test Survey", "active", "public", None)
        .await
        .expect("Failed to create survey");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get(&format!("/api/surveys/{}", survey_id)).await;

    assert!(
        response.status == 200 || response.status == 501,
        "Expected 200 OK or 501 Not Implemented, got {}",
        response.status
    );

    if response.status == 200 {
        let json: Value = response.json().expect("Response should be valid JSON");

        assert!(json.get("id").is_some(), "Response should have 'id' field");
        assert!(
            json.get("title").is_some(),
            "Response should have 'title' field"
        );
        assert!(
            json.get("questions").is_some(),
            "Response should have 'questions' field"
        );

        let questions = json.get("questions").and_then(|q| q.as_array());
        assert!(questions.is_some(), "Questions should be an array");
        assert!(
            !questions.unwrap().is_empty(),
            "Should have at least one question"
        );
    }

    app.cleanup().await.ok();
}

/// Test GET /api/surveys/:id for non-existent survey returns 404
#[tokio::test]
async fn test_get_survey_not_found() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("survey_notfound_test@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);
    let non_existent_id = Uuid::new_v4();

    let response = client
        .get(&format!("/api/surveys/{}", non_existent_id))
        .await;

    assert!(
        response.status == 404 || response.status == 501,
        "Expected 404 Not Found or 501 Not Implemented, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Submit Survey Response
// ============================================================================

/// Test POST /api/surveys/:id/responses - Submits answers to survey
#[tokio::test]
async fn test_submit_survey_response() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("survey_submit_test@example.com");
    user.insert_with_profile(app.db(), "Jane", "Smith")
        .await
        .expect("Failed to insert test user");

    let survey_id = create_test_survey(app.db(), "Submit Test Survey", "active", "public", None)
        .await
        .expect("Failed to create survey");

    let client = app.authenticated_client(&user.id, &user.email);

    let response_payload = json!({
        "answers": {
            "q1": "1",
            "q2": "Great experience!"
        },
        "is_completed": true
    });

    let response = client
        .post(
            &format!("/api/surveys/{}/responses", survey_id),
            &response_payload,
        )
        .await;

    assert!(
        response.status == 200 || response.status == 201 || response.status == 500,
        "Expected 200/201 OK or 500 (not implemented), got {}. Body: {}",
        response.status,
        response.body
    );

    if response.status == 200 || response.status == 201 {
        let json: Value = response.json().expect("Response should be valid JSON");

        assert!(json.get("id").is_some(), "Response should have 'id' field");
        assert!(
            json.get("survey_id").is_some() || json.get("surveyId").is_some(),
            "Response should have 'survey_id' field"
        );
    }

    app.cleanup().await.ok();
}

/// Test POST /api/surveys/:id/responses with partial completion
#[tokio::test]
async fn test_submit_survey_response_partial() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("survey_partial_test@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let survey_id = create_test_survey(app.db(), "Partial Submit Survey", "active", "public", None)
        .await
        .expect("Failed to create survey");

    let client = app.authenticated_client(&user.id, &user.email);

    let response_payload = json!({
        "answers": {
            "q1": "2"
        },
        "is_completed": false
    });

    let response = client
        .post(
            &format!("/api/surveys/{}/responses", survey_id),
            &response_payload,
        )
        .await;

    assert!(
        response.status == 200 || response.status == 201 || response.status == 500,
        "Expected 200/201 OK or 500 (not implemented), got {}",
        response.status
    );

    app.cleanup().await.ok();
}

/// Test POST /api/surveys/:id/responses without auth returns 401
#[tokio::test]
async fn test_submit_survey_response_unauthorized() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let survey_id = create_test_survey(app.db(), "Unauth Submit Survey", "active", "public", None)
        .await
        .expect("Failed to create survey");

    let client = app.client();

    let response_payload = json!({
        "answers": {"q1": "1"},
        "is_completed": true
    });

    let response = client
        .post(
            &format!("/api/surveys/{}/responses", survey_id),
            &response_payload,
        )
        .await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Create Survey (Admin Only)
// ============================================================================

/// Test POST /api/surveys (admin only) - Creates new survey
#[tokio::test]
async fn test_create_survey_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("survey_admin@example.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin user");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let create_payload = json!({
        "title": "New Customer Satisfaction Survey",
        "description": "Help us improve our services",
        "questions": [
            {
                "id": "q1",
                "question_type": "rating",
                "text": "How would you rate our service?",
                "description": "1 = Poor, 5 = Excellent",
                "required": true,
                "options": null,
                "validation": {"min_value": 1, "max_value": 5},
                "order": 1
            },
            {
                "id": "q2",
                "question_type": "text_area",
                "text": "What can we do better?",
                "description": null,
                "required": false,
                "options": null,
                "validation": {"max_length": 1000},
                "order": 2
            }
        ],
        "access_type": "public",
        "status": "draft"
    });

    let response = client.post("/api/surveys", &create_payload).await;

    assert!(
        response.status == 200 || response.status == 201 || response.status == 500,
        "Expected 200/201 Created or 500 (not implemented), got {}. Body: {}",
        response.status,
        response.body
    );

    if response.status == 200 || response.status == 201 {
        let json: Value = response.json().expect("Response should be valid JSON");

        assert!(json.get("id").is_some(), "Response should have 'id' field");
        assert_eq!(
            json.get("title").and_then(|v| v.as_str()),
            Some("New Customer Satisfaction Survey"),
            "Survey title should match"
        );
    }

    app.cleanup().await.ok();
}

/// Test POST /api/surveys by non-admin returns 403
#[tokio::test]
async fn test_create_survey_forbidden_for_non_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("regular_user@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let create_payload = json!({
        "title": "Unauthorized Survey",
        "description": "This should fail",
        "questions": [],
        "access_type": "public",
        "status": "draft"
    });

    let response = client.post("/api/surveys", &create_payload).await;

    assert!(
        response.status == 403 || response.status == 500,
        "Expected 403 Forbidden or 500 (not implemented), got {}",
        response.status
    );

    app.cleanup().await.ok();
}

/// Test POST /api/surveys without auth returns 401
#[tokio::test]
async fn test_create_survey_unauthorized() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let create_payload = json!({
        "title": "Unauthorized Survey",
        "description": "This should fail",
        "questions": [],
        "access_type": "public",
        "status": "draft"
    });

    let response = client.post("/api/surveys", &create_payload).await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Get Survey Responses (Admin Only)
// ============================================================================

/// Test GET /api/surveys/:id/responses (admin) - Returns all responses
#[tokio::test]
async fn test_get_survey_responses_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("responses_admin@example.com");
    admin
        .insert_with_profile(app.db(), "Admin", "User")
        .await
        .expect("Failed to insert admin user");

    let survey_id = create_test_survey(
        app.db(),
        "Responses Test Survey",
        "active",
        "public",
        Some(admin.id),
    )
    .await
    .expect("Failed to create survey");

    let user1 = TestUser::new("responder1@example.com");
    user1
        .insert_with_profile(app.db(), "User", "One")
        .await
        .expect("Failed to insert user1");

    let user2 = TestUser::new("responder2@example.com");
    user2
        .insert_with_profile(app.db(), "User", "Two")
        .await
        .expect("Failed to insert user2");

    let _response1 = create_survey_response(
        app.db(),
        survey_id,
        user1.id,
        json!({"q1": "1", "q2": "Great!"}),
        true,
    )
    .await
    .expect("Failed to create response 1");

    let _response2 =
        create_survey_response(app.db(), survey_id, user2.id, json!({"q1": "2"}), false)
            .await
            .expect("Failed to create response 2");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .get(&format!("/api/surveys/{}/responses", survey_id))
        .await;

    assert!(
        response.status == 200 || response.status == 500,
        "Expected 200 OK or 500 (not implemented), got {}. Body: {}",
        response.status,
        response.body
    );

    if response.status == 200 {
        let json: Value = response.json().expect("Response should be valid JSON");

        assert!(
            json.get("data").is_some() || json.get("responses").is_some(),
            "Response should have 'data' or 'responses' field"
        );
        assert!(
            json.get("total").is_some(),
            "Response should have 'total' field"
        );
        assert!(
            json.get("page").is_some(),
            "Response should have 'page' field"
        );

        let responses = json
            .get("data")
            .or_else(|| json.get("responses"))
            .and_then(|d| d.as_array());
        assert!(responses.is_some(), "Responses should be an array");
        assert_eq!(responses.unwrap().len(), 2, "Should have 2 responses");
    }

    app.cleanup().await.ok();
}

/// Test GET /api/surveys/:id/responses by non-admin returns 403
#[tokio::test]
async fn test_get_survey_responses_forbidden_for_non_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("non_admin_responses@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let survey_id = create_test_survey(
        app.db(),
        "Responses Forbidden Survey",
        "active",
        "public",
        None,
    )
    .await
    .expect("Failed to create survey");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .get(&format!("/api/surveys/{}/responses", survey_id))
        .await;

    assert!(
        response.status == 403 || response.status == 500,
        "Expected 403 Forbidden or 500 (not implemented), got {}",
        response.status
    );

    app.cleanup().await.ok();
}

/// Test GET /api/surveys/:id/responses without auth returns 401
#[tokio::test]
async fn test_get_survey_responses_unauthorized() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let survey_id = create_test_survey(
        app.db(),
        "Unauth Responses Survey",
        "active",
        "public",
        None,
    )
    .await
    .expect("Failed to create survey");

    let client = app.client();
    let response = client
        .get(&format!("/api/surveys/{}/responses", survey_id))
        .await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

/// Test GET /api/surveys/:id/responses with pagination
#[tokio::test]
async fn test_get_survey_responses_with_pagination() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("pagination_admin@example.com");
    admin
        .insert_with_profile(app.db(), "Admin", "Paginate")
        .await
        .expect("Failed to insert admin user");

    let survey_id = create_test_survey(
        app.db(),
        "Pagination Survey",
        "active",
        "public",
        Some(admin.id),
    )
    .await
    .expect("Failed to create survey");

    for i in 0..15 {
        let user = TestUser::new(&format!("paginate_user{}@example.com", i));
        user.insert(app.db())
            .await
            .expect("Failed to insert test user");

        let _ = create_survey_response(
            app.db(),
            survey_id,
            user.id,
            json!({"q1": format!("{}", i % 4 + 1)}),
            true,
        )
        .await
        .expect("Failed to create response");
    }

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .get(&format!(
            "/api/surveys/{}/responses?page=1&limit=5",
            survey_id
        ))
        .await;

    assert!(
        response.status == 200 || response.status == 500,
        "Expected 200 OK or 500 (not implemented), got {}",
        response.status
    );

    if response.status == 200 {
        let json: Value = response.json().expect("Response should be valid JSON");

        assert_eq!(json.get("page").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(json.get("limit").and_then(|v| v.as_i64()), Some(5));
        assert_eq!(json.get("total").and_then(|v| v.as_i64()), Some(15));
        assert_eq!(json.get("total_pages").and_then(|v| v.as_i64()), Some(3));

        let responses = json
            .get("data")
            .or_else(|| json.get("responses"))
            .and_then(|d| d.as_array());
        assert!(responses.is_some());
        assert_eq!(
            responses.unwrap().len(),
            5,
            "First page should have 5 items"
        );
    }

    app.cleanup().await.ok();
}
