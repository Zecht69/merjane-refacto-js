import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import {mockDeep, type DeepMockProxy} from 'vitest-mock-extended';
import {type INotificationService} from '../notifications.port.js';
import {createDatabaseMock, cleanUp} from '../../utils/test-utils/database-tools.ts.js';
import {ProductService} from './product.service.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('ProductService', () => {
	let notificationServiceMock: DeepMockProxy<INotificationService>;
	let productService: ProductService;
	let db: Database;
	let databaseName: string;
	let closeDatabase: () => void;

	beforeEach(async () => {
		({databaseMock: db, databaseName, close: closeDatabase} = await createDatabaseMock());
		notificationServiceMock = mockDeep<INotificationService>();
		productService = new ProductService({ns: notificationServiceMock, db});
	});

	afterEach(async () => {
		closeDatabase();
		await cleanUp(databaseName);
	});

	async function insertProduct(product: Product) {
		await db.insert(products).values(product);
	}

	async function getProduct(id: number) {
		return db.query.products.findFirst({where: (p, {eq}) => eq(p.id, id)});
	}

	// ─── notifyDelay ─────────────────────────────────────────────────────────────

	describe('notifyDelay', () => {
		it('should update lead time and send delay notification', async () => {
			const product: Product = {
				id: 1, leadTime: 15, available: 0, type: 'NORMAL',
				name: 'RJ45 Cable', expiryDate: null, seasonStartDate: null, seasonEndDate: null,
			};
			await insertProduct(product);

			await productService.notifyDelay(15, product);

			expect(product.leadTime).toBe(15);
			expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(15, 'RJ45 Cable');
			expect(await getProduct(1)).toEqual(product);
		});
	});

	// ─── NORMAL products ─────────────────────────────────────────────────────────

	describe('processProduct — NORMAL', () => {
		it('should decrement available when stock > 0', async () => {
			const product: Product = {
				id: 1, leadTime: 5, available: 10, type: 'NORMAL',
				name: 'USB Cable', expiryDate: null, seasonStartDate: null, seasonEndDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(9);
			expect((await getProduct(1))!.available).toBe(9);
			expect(notificationServiceMock.sendDelayNotification).not.toHaveBeenCalled();
		});

		it('should send delay notification when out of stock and leadTime > 0', async () => {
			const product: Product = {
				id: 1, leadTime: 10, available: 0, type: 'NORMAL',
				name: 'USB Dongle', expiryDate: null, seasonStartDate: null, seasonEndDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(0);
			expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(10, 'USB Dongle');
		});

		it('should do nothing when out of stock and leadTime is 0', async () => {
			const product: Product = {
				id: 1, leadTime: 0, available: 0, type: 'NORMAL',
				name: 'Legacy Part', expiryDate: null, seasonStartDate: null, seasonEndDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(0);
			expect(notificationServiceMock.sendDelayNotification).not.toHaveBeenCalled();
		});
	});

	// ─── EXPIRABLE products ───────────────────────────────────────────────────────

	describe('processProduct — EXPIRABLE', () => {
		it('should decrement available when stock > 0 and not expired', async () => {
			const product: Product = {
				id: 1, leadTime: 5, available: 20, type: 'EXPIRABLE',
				name: 'Butter', expiryDate: new Date(Date.now() + (30 * DAY_MS)),
				seasonStartDate: null, seasonEndDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(19);
			expect((await getProduct(1))!.available).toBe(19);
			expect(notificationServiceMock.sendExpirationNotification).not.toHaveBeenCalled();
		});

		it('should send expiration notification and zero stock when expired', async () => {
			const expiryDate = new Date(Date.now() - (2 * DAY_MS));
			const product: Product = {
				id: 1, leadTime: 5, available: 5, type: 'EXPIRABLE',
				name: 'Milk', expiryDate,
				seasonStartDate: null, seasonEndDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(0);
			expect((await getProduct(1))!.available).toBe(0);
			expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith('Milk', expiryDate);
		});

		it('should send expiration notification and zero stock when out of stock', async () => {
			const expiryDate = new Date(Date.now() + (30 * DAY_MS));
			const product: Product = {
				id: 1, leadTime: 5, available: 0, type: 'EXPIRABLE',
				name: 'Yogurt', expiryDate,
				seasonStartDate: null, seasonEndDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(0);
			expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith('Yogurt', expiryDate);
		});
	});

	// ─── SEASONAL products ────────────────────────────────────────────────────────

	describe('processProduct — SEASONAL', () => {
		it('should decrement available when in season and stock > 0', async () => {
			const product: Product = {
				id: 1, leadTime: 15, available: 30, type: 'SEASONAL',
				name: 'Watermelon',
				seasonStartDate: new Date(Date.now() - (10 * DAY_MS)),
				seasonEndDate: new Date(Date.now() + (60 * DAY_MS)),
				expiryDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(29);
			expect((await getProduct(1))!.available).toBe(29);
			expect(notificationServiceMock.sendOutOfStockNotification).not.toHaveBeenCalled();
		});

		it('should send delay notification when in season but out of stock and restock fits in season', async () => {
			const product: Product = {
				id: 1, leadTime: 5, available: 0, type: 'SEASONAL',
				name: 'Strawberry',
				seasonStartDate: new Date(Date.now() - (10 * DAY_MS)),
				seasonEndDate: new Date(Date.now() + (60 * DAY_MS)),
				expiryDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(5, 'Strawberry');
			expect(notificationServiceMock.sendOutOfStockNotification).not.toHaveBeenCalled();
		});

		it('should send out-of-stock notification when season has not started yet', async () => {
			const product: Product = {
				id: 1, leadTime: 15, available: 30, type: 'SEASONAL',
				name: 'Grapes',
				seasonStartDate: new Date(Date.now() + (180 * DAY_MS)),
				seasonEndDate: new Date(Date.now() + (240 * DAY_MS)),
				expiryDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith('Grapes');
			expect(notificationServiceMock.sendDelayNotification).not.toHaveBeenCalled();
		});

		it('should send out-of-stock notification when lead time overshoots end of season', async () => {
			const product: Product = {
				id: 1, leadTime: 90, available: 0, type: 'SEASONAL',
				name: 'Fig',
				seasonStartDate: new Date(Date.now() - (10 * DAY_MS)),
				seasonEndDate: new Date(Date.now() + (20 * DAY_MS)),
				expiryDate: null,
			};
			await insertProduct(product);

			await productService.processProduct(product);

			expect(product.available).toBe(0);
			expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith('Fig');
			expect(notificationServiceMock.sendDelayNotification).not.toHaveBeenCalled();
		});
	});
});