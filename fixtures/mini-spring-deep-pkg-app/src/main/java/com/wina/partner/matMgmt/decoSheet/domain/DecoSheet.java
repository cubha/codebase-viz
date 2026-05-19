package com.wina.partner.matMgmt.decoSheet.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "deco_sheets")
public class DecoSheet {
    @Id @GeneratedValue private Long id;
    @Column(nullable = false) private String name;
    @Column private String spec;
}
