import {type Cradle} from '@fastify/awilix';
import {eq} from 'drizzle-orm';
import {type INotificationService} from '../notifications.port.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export class ProductService {
	private readonly notificationService: INotificationService;
	private readonly db: Database;

	public constructor({notificationService, db}: Pick<Cradle, 'notificationService' | 'db'>) {
		this.notificationService = notificationService;
		this.db = db;
	}

	public async processProduct(p: Product): Promise<void> {
		switch (p.type) {
			case 'NORMAL': {
				await this.handleNormalProduct(p);
				break;
			}

			case 'SEASONAL': {
				await this.handleSeasonalProduct(p);
				break;
			}

			case 'EXPIRABLE': {
				await this.handleExpirableProduct(p);
				break;
			}
		}
	}

	public async notifyDelay(leadTime: number, p: Product): Promise<void> {
		p.leadTime = leadTime;
		await this.db.update(products).set(p).where(eq(products.id, p.id));
		this.notificationService.sendDelayNotification(leadTime, p.name);
	}

	private async handleNormalProduct(p: Product): Promise<void> {
		if (p.available > 0) {
			p.available -= 1;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		} else if (p.leadTime > 0) {
			await this.notifyDelay(p.leadTime, p);
		}
	}

	private async handleSeasonalProduct(p: Product): Promise<void> {
		const currentDate = new Date();

		if (currentDate > p.seasonStartDate! && currentDate < p.seasonEndDate! && p.available > 0) {
			p.available -= 1;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
			return;
		}

		// If restocking would arrive after the season ends
		// the product becomes unavailable
		if (new Date(currentDate.getTime() + (p.leadTime * MS_PER_DAY)) > p.seasonEndDate!) {
			this.notificationService.sendOutOfStockNotification(p.name);
			p.available = 0;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		} else if (p.seasonStartDate! > currentDate) {
			this.notificationService.sendOutOfStockNotification(p.name);
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		} else {
			await this.notifyDelay(p.leadTime, p);
		}
	}

	private async handleExpirableProduct(p: Product): Promise<void> {
		const currentDate = new Date();
		if (p.available > 0 && p.expiryDate! > currentDate) {
			p.available -= 1;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		} else {
			this.notificationService.sendExpirationNotification(p.name, p.expiryDate!);
			p.available = 0;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		}
	}
}
