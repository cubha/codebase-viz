package com.wina.partner.matMgmt.decoSheet.service;

import com.wina.partner.matMgmt.decoSheet.repository.DecoSheetRepository;
import org.springframework.stereotype.Service;

@Service
public class DecoSheetService {
    private final DecoSheetRepository repository;

    public DecoSheetService(DecoSheetRepository repository) {
        this.repository = repository;
    }

    public String findAll() { return ""; }
    public String findById(Long id) { return ""; }
    public String create(String body) { return ""; }
}
