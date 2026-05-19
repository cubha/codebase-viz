package com.wina.admin.repository;

import com.wina.admin.domain.AuditLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AdminRepository extends JpaRepository<AuditLog, Long> {
}
