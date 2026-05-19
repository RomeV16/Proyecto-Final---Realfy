import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { UserRole } from '@realfy/shared';

const CLS_TENANT_ID = 'tenantId';
const CLS_USER_ID = 'userId';
const CLS_USER_ROLE = 'userRole';
const CLS_IP_ADDRESS = 'ipAddress';
const CLS_BYPASS_TENANT = 'bypassTenantFilter';
const CLS_PERSON_ID = 'personId';
const CLS_IS_PORTAL_REQUEST = 'isPortalRequest';

@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService) {}

  getTenantId(): string | undefined {
    return this.cls.get(CLS_TENANT_ID);
  }

  setTenantId(tenantId: string): void {
    this.cls.set(CLS_TENANT_ID, tenantId);
  }

  getUserId(): string | undefined {
    return this.cls.get(CLS_USER_ID);
  }

  setUserId(userId: string): void {
    this.cls.set(CLS_USER_ID, userId);
  }

  getUserRole(): UserRole | undefined {
    return this.cls.get(CLS_USER_ROLE);
  }

  setUserRole(role: UserRole): void {
    this.cls.set(CLS_USER_ROLE, role);
  }

  getIpAddress(): string | undefined {
    return this.cls.get(CLS_IP_ADDRESS);
  }

  setIpAddress(ip: string): void {
    this.cls.set(CLS_IP_ADDRESS, ip);
  }

  isTenantFilterBypassed(): boolean {
    return !!this.cls.get(CLS_BYPASS_TENANT);
  }

  setBypassTenantFilter(bypass: boolean): void {
    this.cls.set(CLS_BYPASS_TENANT, bypass);
  }

  getPersonId(): string | undefined {
    return this.cls.get(CLS_PERSON_ID);
  }

  setPersonId(personId: string): void {
    this.cls.set(CLS_PERSON_ID, personId);
  }

  getIsPortalRequest(): boolean {
    return !!this.cls.get(CLS_IS_PORTAL_REQUEST);
  }

  setIsPortalRequest(isPortal: boolean): void {
    this.cls.set(CLS_IS_PORTAL_REQUEST, isPortal);
  }
}
