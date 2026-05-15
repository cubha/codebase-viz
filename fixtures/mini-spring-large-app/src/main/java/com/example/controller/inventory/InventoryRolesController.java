package com.example.controller.inventory;

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/inventory/roles")
public class InventoryRolesController {

    @GetMapping
    public List<Object> list() {
        return List.of();
    }

    @GetMapping("/{id}")
    public Object getOne(@PathVariable Long id) {
        return null;
    }

    @PostMapping
    public Object create(@RequestBody Object body) {
        return null;
    }

    @PutMapping("/{id}")
    public Object update(@PathVariable Long id, @RequestBody Object body) {
        return null;
    }

    @DeleteMapping("/{id}")
    public void remove(@PathVariable Long id) {
    }
}
