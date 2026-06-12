package com.wina.partner.common.commonPop.controller;

import com.wina.partner.common.commonPop.service.CommonPopService;
import com.wina.partner.common.commonPop.service.PerfStatusService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class CommonPopController {

    private final CommonPopService commonPopService;
    private final PerfStatusService perfStatusService;

    @GetMapping("/v1/partner/agency-popup")
    public Object retrieveAgencyPopup() {
        return commonPopService.retrieveAgencyPopup();
    }

    @PostMapping("/v1/partner/label-yn")
    public Object savePrdoWryLabelYn(@RequestBody Object updateList) {
        return commonPopService.savePrdoWryLabelYn(updateList);
    }

    @GetMapping("/v1/partner/perf")
    public Object retrievePerfStatus() {
        return perfStatusService.retrievePerfStatus();
    }
}
