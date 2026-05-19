package com.wina.partner.matMgmt.decoSheet.controller;

import com.wina.partner.matMgmt.decoSheet.service.DecoSheetService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/partner/decoSheet")
public class DecoSheetController {
    private final DecoSheetService service;

    public DecoSheetController(DecoSheetService service) {
        this.service = service;
    }

    @GetMapping public String list() { return service.findAll(); }
    @GetMapping("/{id}") public String get(@PathVariable Long id) { return service.findById(id); }
    @PostMapping public String create(@RequestBody String body) { return service.create(body); }
}
