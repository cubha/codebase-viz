package com.wina.admin.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "audit_logs")
public class AuditLog {
    @Id @GeneratedValue private Long id;
    @Column(nullable = false) private String action;
    @Column private String detail;
}
