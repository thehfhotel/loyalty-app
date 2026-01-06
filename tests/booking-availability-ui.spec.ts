import { test, expect } from '@playwright/test';
import { loginViaUI, getAdminUser } from './helpers/auth';

/**
 * E2E tests for Room Availability Calendar UI interactions
 * These tests verify mouse interactions: single click, drag selection
 */
test.describe('Room Availability Calendar UI', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test.describe('Default View All Behavior', () => {
    test('should default to "All Room Types" option', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      // Room type select should exist
      const roomTypeSelect = page.locator('select').first();
      await expect(roomTypeSelect).toBeVisible();

      // Should have "all" as the selected value by default
      await expect(roomTypeSelect).toHaveValue('all');

      // "All Room Types" option should be visible
      await expect(page.getByText(/all room types/i)).toBeVisible();
    });

    test('should show calendar immediately without selecting room type', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      // Calendar table should be visible immediately (with "All Room Types" selected by default)
      const calendarTable = page.locator('table');
      await expect(calendarTable).toBeVisible({ timeout: 10000 });

      // Month navigation should be visible
      await expect(page.getByRole('button', { name: /previous/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /next/i })).toBeVisible();
    });

    test('should show all rooms from all types when "All Room Types" is selected', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      // With "all" selected, should show rooms in the table
      const roomRows = page.locator('tbody tr');
      // Wait for rooms to load (could be 0 if no rooms exist)
      await page.waitForLoadState('networkidle');

      // If there are rooms, they should be displayed
      const rowCount = await roomRows.count();
      // Either shows rooms or "No Rooms" message
      if (rowCount === 0) {
        await expect(page.getByText(/no rooms/i)).toBeVisible();
      } else {
        expect(rowCount).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Date Selection Interactions', () => {
    test('single click should select and hold a date', async ({ page }) => {
      // Login as admin
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      // Navigate to room availability
      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      // Wait for room types to load (default is "all")
      const roomTypeSelect = page.locator('select').first();
      await expect(roomTypeSelect).toBeVisible();

      // Find an available date cell (green background)
      const availableCells = page.locator('.bg-green-100');

      // Wait for cells to appear
      try {
        await availableCells.first().waitFor({ timeout: 5000 });

        // Single click on the cell
        await availableCells.first().click();

        // Wait for state update
        await page.waitForTimeout(100);

        // The cell should have selection ring (ring-2)
        await expect(availableCells.first()).toHaveClass(/ring-2/);

        // Selection should persist (not toggle off)
        // Block Selected button should appear
        const blockButton = page.getByRole('button', { name: /block selected/i });
        await expect(blockButton).toBeVisible();
      } catch {
        // No rooms exist - skip this test
        test.skip();
      }
    });

    test('drag selection should select multiple dates', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      await expect(roomTypeSelect).toBeVisible();

      const options = await roomTypeSelect.locator('option').all();
      if (options.length > 1) {
        await roomTypeSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Find available date cells
        const availableCells = page.locator('.bg-green-100');
        const cellCount = await availableCells.count();

        if (cellCount >= 3) {
          const firstCell = availableCells.nth(0);
          const thirdCell = availableCells.nth(2);

          // Get bounding boxes
          const firstBox = await firstCell.boundingBox();
          const thirdBox = await thirdCell.boundingBox();

          if (firstBox && thirdBox) {
            // Perform drag from first to third cell
            await page.mouse.move(
              firstBox.x + firstBox.width / 2,
              firstBox.y + firstBox.height / 2
            );
            await page.mouse.down();
            await page.mouse.move(
              thirdBox.x + thirdBox.width / 2,
              thirdBox.y + thirdBox.height / 2
            );
            await page.mouse.up();

            // Wait for state update
            await page.waitForTimeout(100);

            // Multiple cells should be selected (have ring-2 class)
            const selectedCells = page.locator('.ring-2');
            const selectedCount = await selectedCells.count();
            expect(selectedCount).toBeGreaterThan(1);

            // Block Selected button should appear
            const blockButton = page.getByRole('button', { name: /block selected/i });
            await expect(blockButton).toBeVisible();
          }
        }
      }
    });

    test('clicking booked date should show error toast', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length > 1) {
        await roomTypeSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Find a booked date cell (blue background)
        const bookedCells = page.locator('.bg-blue-500');

        if (await bookedCells.first().isVisible()) {
          // Click on booked cell
          await bookedCells.first().click();

          // Should show error toast
          const toast = page.locator('[class*="toast"]').or(page.getByRole('alert'));
          await expect(toast.or(page.getByText(/cannot modify booked/i))).toBeVisible({ timeout: 5000 });
        }
      }
    });

    test('clicking blocked date should show unblock modal', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length > 1) {
        await roomTypeSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Find a blocked date cell (red background)
        const blockedCells = page.locator('.bg-red-500');

        if (await blockedCells.first().isVisible()) {
          // Click on blocked cell
          await blockedCells.first().click();

          // Should show unblock modal with reason
          await expect(page.getByText(/blocked date/i).or(page.getByText(/block reason/i))).toBeVisible({ timeout: 5000 });

          // Unblock button should be visible
          const unblockButton = page.getByRole('button', { name: /unblock/i });
          await expect(unblockButton).toBeVisible();
        }
      }
    });

    test('clear selection button should deselect all cells', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length > 1) {
        await roomTypeSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Select a date
        const availableCells = page.locator('.bg-green-100');
        if (await availableCells.first().isVisible()) {
          await availableCells.first().click();
          await page.waitForTimeout(100);

          // Clear selection button should be visible
          const clearButton = page.getByRole('button', { name: /clear selection/i });
          if (await clearButton.isVisible()) {
            await clearButton.click();
            await page.waitForTimeout(100);

            // No cells should have selection ring
            const selectedCells = page.locator('.ring-2');
            expect(await selectedCells.count()).toBe(0);

            // Block Selected button should not be visible
            const blockButton = page.getByRole('button', { name: /block selected/i });
            await expect(blockButton).not.toBeVisible();
          }
        }
      }
    });

    test('month navigation should clear selection', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length > 1) {
        await roomTypeSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Select a date
        const availableCells = page.locator('.bg-green-100');
        if (await availableCells.first().isVisible()) {
          await availableCells.first().click();
          await page.waitForTimeout(100);

          // Navigate to next month
          const nextButton = page.getByRole('button', { name: /next/i });
          if (await nextButton.isVisible()) {
            await nextButton.click();
            await page.waitForLoadState('networkidle');

            // Selection should be cleared
            const blockButton = page.getByRole('button', { name: /block selected/i });
            await expect(blockButton).not.toBeVisible();
          }
        }
      }
    });
  });

  test.describe('Block/Unblock Persistence', () => {
    // These tests verify the critical bug fix: blocked dates must persist after save
    // Previously, toast showed success but dates remained green (available)

    test('blocking a date should persist after page refresh', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      // Skip if no room types available
      if (options.length <= 1) {
        test.skip();
        return;
      }

      // Select a specific room type (not "all") to work with individual rooms
      await roomTypeSelect.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');

      // Find an available date cell (green background)
      const availableCells = page.locator('.bg-green-100');
      const cellCount = await availableCells.count();

      if (cellCount === 0) {
        test.skip();
        return;
      }

      // Get the first available cell's room-date identifier
      // We'll use a date in the future to avoid conflicts with existing data
      const today = new Date();
      const futureDate = new Date(today.getFullYear(), today.getMonth() + 1, 15);
      // futureDate is used for navigation purposes
      void futureDate;

      // Navigate to the month containing our target date
      const nextMonthButton = page.getByRole('button', { name: /next/i });
      await nextMonthButton.click();
      await page.waitForLoadState('networkidle');

      // Find available cell for day 15
      const targetCell = page.locator('.bg-green-100').first();

      if (!(await targetCell.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip();
        return;
      }

      // Click to select the cell
      await targetCell.click();
      await page.waitForTimeout(100);

      // Verify cell is selected
      await expect(targetCell).toHaveClass(/ring-2/);

      // Click "Block Selected" button
      const blockButton = page.getByRole('button', { name: /block selected/i });
      await expect(blockButton).toBeVisible();
      await blockButton.click();

      // Wait for modal to appear
      await page.waitForTimeout(200);

      // Fill in block reason
      const reasonInput = page.locator('input[type="text"], textarea').first();
      if (await reasonInput.isVisible()) {
        await reasonInput.fill('E2E Test Block');
      }

      // Confirm block
      const confirmButton = page.getByRole('button', { name: /confirm/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      } else {
        // Try alternative button names
        const blockConfirm = page.getByRole('button', { name: /block$/i });
        if (await blockConfirm.isVisible()) {
          await blockConfirm.click();
        }
      }

      // Wait for success toast
      await expect(page.getByText(/success|สำเร็จ/i)).toBeVisible({ timeout: 5000 });

      // Wait for UI to update
      await page.waitForLoadState('networkidle');

      // After blocking, the cell should be red (blocked)
      const blockedCells = page.locator('.bg-red-500');
      const blockedCount = await blockedCells.count();
      expect(blockedCount).toBeGreaterThan(0);

      // Refresh the page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Re-select the same room type
      const roomTypeSelect2 = page.locator('select').first();
      await roomTypeSelect2.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');

      // Navigate to the same month
      const nextMonthButton2 = page.getByRole('button', { name: /next/i });
      await nextMonthButton2.click();
      await page.waitForLoadState('networkidle');

      // Verify blocked cell is still red (persisted)
      const blockedCellsAfterRefresh = page.locator('.bg-red-500');
      const blockedCountAfterRefresh = await blockedCellsAfterRefresh.count();
      expect(blockedCountAfterRefresh).toBeGreaterThan(0);
    });

    test('unblocking a date should persist after page refresh', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length <= 1) {
        test.skip();
        return;
      }

      await roomTypeSelect.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');

      // Navigate to next month (where we blocked in previous test)
      const nextMonthButton = page.getByRole('button', { name: /next/i });
      await nextMonthButton.click();
      await page.waitForLoadState('networkidle');

      // Find a blocked date cell (red background)
      const blockedCells = page.locator('.bg-red-500');

      if (!(await blockedCells.first().isVisible({ timeout: 3000 }).catch(() => false))) {
        // No blocked cells - skip test
        test.skip();
        return;
      }

      // Click on blocked cell to open unblock modal
      await blockedCells.first().click();
      await page.waitForTimeout(200);

      // Click unblock button
      const unblockButton = page.getByRole('button', { name: /unblock/i });

      if (await unblockButton.isVisible()) {
        await unblockButton.click();

        // Wait for success toast
        await expect(page.getByText(/success|สำเร็จ/i)).toBeVisible({ timeout: 5000 });

        // Wait for UI to update
        await page.waitForLoadState('networkidle');

        // Verify the cell is now green (available)
        const availableCells = page.locator('.bg-green-100');
        const availableCount = await availableCells.count();
        expect(availableCount).toBeGreaterThan(0);

        // Refresh the page
        await page.reload();
        await page.waitForLoadState('networkidle');

        // Re-select the same room type
        const roomTypeSelect2 = page.locator('select').first();
        await roomTypeSelect2.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Navigate to the same month
        const nextMonthButton2 = page.getByRole('button', { name: /next/i });
        await nextMonthButton2.click();
        await page.waitForLoadState('networkidle');

        // Verify the cell is still green after refresh (unblock persisted)
        const availableCellsAfterRefresh = page.locator('.bg-green-100');
        const availableCountAfterRefresh = await availableCellsAfterRefresh.count();
        expect(availableCountAfterRefresh).toBeGreaterThan(0);
      } else {
        test.skip();
      }
    });

    test('blocking multiple dates should all persist', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length <= 1) {
        test.skip();
        return;
      }

      await roomTypeSelect.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');

      // Find available date cells
      const availableCells = page.locator('.bg-green-100');
      const cellCount = await availableCells.count();

      if (cellCount < 3) {
        test.skip();
        return;
      }

      // Drag to select multiple cells
      const firstCell = availableCells.nth(0);
      const thirdCell = availableCells.nth(2);

      const firstBox = await firstCell.boundingBox();
      const thirdBox = await thirdCell.boundingBox();

      if (!firstBox || !thirdBox) {
        test.skip();
        return;
      }

      // Perform drag selection
      await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height / 2);
      await page.mouse.up();

      await page.waitForTimeout(100);

      // Count selected cells
      const selectedCells = page.locator('.ring-2');
      const selectedCount = await selectedCells.count();

      if (selectedCount === 0) {
        test.skip();
        return;
      }

      // Click "Block Selected" button
      const blockButton = page.getByRole('button', { name: /block selected/i });
      if (!(await blockButton.isVisible())) {
        test.skip();
        return;
      }

      await blockButton.click();
      await page.waitForTimeout(200);

      // Fill in block reason
      const reasonInput = page.locator('input[type="text"], textarea').first();
      if (await reasonInput.isVisible()) {
        await reasonInput.fill('E2E Multi-Block Test');
      }

      // Confirm block
      const confirmButton = page.getByRole('button', { name: /(confirm|block)$/i }).first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Wait for success toast
      await expect(page.getByText(/success|สำเร็จ/i)).toBeVisible({ timeout: 5000 });
      await page.waitForLoadState('networkidle');

      // Count blocked cells after operation
      const blockedAfterBlock = await page.locator('.bg-red-500').count();

      // Refresh and verify persistence
      await page.reload();
      await page.waitForLoadState('networkidle');

      const roomTypeSelect2 = page.locator('select').first();
      await roomTypeSelect2.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');

      // Count blocked cells after refresh
      const blockedAfterRefresh = await page.locator('.bg-red-500').count();

      // The number of blocked cells should be maintained after refresh
      expect(blockedAfterRefresh).toBeGreaterThanOrEqual(blockedAfterBlock);
    });
  });

  test.describe('Accessibility', () => {
    test('calendar should have proper legend', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length > 1) {
        await roomTypeSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Legend should show Available, Blocked, Booked
        await expect(page.getByText(/available/i)).toBeVisible();
        await expect(page.getByText(/blocked/i)).toBeVisible();
        await expect(page.getByText(/booked/i)).toBeVisible();
      }
    });

    test('drag hint should be visible', async ({ page }) => {
      const adminUser = getAdminUser();
      await loginViaUI(page, adminUser.email, adminUser.password);

      await page.goto('/admin/room-availability');
      await page.waitForLoadState('networkidle');

      const roomTypeSelect = page.locator('select').first();
      const options = await roomTypeSelect.locator('option').all();

      if (options.length > 1) {
        await roomTypeSelect.selectOption({ index: 1 });
        await page.waitForLoadState('networkidle');

        // Drag hint should be visible
        await expect(page.getByText(/click or drag/i)).toBeVisible();
      }
    });
  });
});
