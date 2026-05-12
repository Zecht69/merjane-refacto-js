import {type Cradle} from '@fastify/awilix';
import {eq} from 'drizzle-orm';
import {type INotificationService} from '../notifications.port.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

export class ProductService {
	private readonly ns: INotificationService;
	private readonly db: Database;

	public constructor({ns, db}: Pick<Cradle, 'ns' | 'db'>) {
		this.ns = ns;
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
		this.ns.sendDelayNotification(leadTime, p.name);
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

		const msPerDay = 1000 * 60 * 60 * 24;
		// If restocking would arrive after the season ends the product becomes unavailable
		if (new Date(currentDate.getTime() + (p.leadTime * msPerDay)) > p.seasonEndDate!) {
			this.ns.sendOutOfStockNotification(p.name);
			p.available = 0;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		} else if (p.seasonStartDate! > currentDate) {
			this.ns.sendOutOfStockNotification(p.name);
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
			this.ns.sendExpirationNotification(p.name, p.expiryDate!);
			p.available = 0;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		}
	}
}