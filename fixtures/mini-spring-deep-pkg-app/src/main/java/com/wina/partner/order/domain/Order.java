package com.wina.partner.order.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "orders")
public class Order {
    @Id @GeneratedValue private Long id;
    @Column(nullable = false) private Integer amount;
    @Column(nullable = false) private String status;
}
